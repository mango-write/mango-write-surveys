// 问卷媒体：题目选项图的认证侧上传/读取与匿名公开资产面。
// 绑定行归 storage port，字节池归 media port（主站 FileService sha256 池 /
// 独立站媒体目录），包只拥有校验与放行规则。
import { randomUUID, createHash } from "node:crypto";

import type { SurveysPorts, SurveyMediaBindingRecord } from "../ports.js";

import { SurveyError } from "./errors.js";
import { SURVEY_MEDIA_MAX_BYTES } from "./limits.js";
import { withMediaShaLock } from "./media-lock.js";
import { assertSurveyImageUpload, InvalidUploadError } from "./upload-validation.js";
import { loadSurveyAccess } from "./service.js";

function safeName(filename: string): string {
  const trimmed = filename.trim().replace(/[^\w.\-]+/g, "_").slice(0, 80);
  const base = trimmed.length > 0 ? trimmed : "image";
  return `${randomUUID().slice(0, 8)}-${base}`;
}

export interface SurveyMediaUploadResult {
  id: string;
  surveyId: string;
  name: string;
  sha256: string;
  mime: string;
  bytes: number;
  createdAt: Date;
  url: string;
}

export function createSurveysMedia(ports: SurveysPorts) {
  const { storage, media, auth } = ports;

  async function requireSurveyAccess(
    userId: string,
    surveyId: string,
    operation: "read" | "write" | "delete",
  ) {
    const access = await loadSurveyAccess(ports, userId, surveyId, operation);
    return access.survey;
  }

  return {
    async uploadSurveyMedia(
      userId: string,
      surveyId: string,
      input: { buffer: Buffer; mime: string; filename: string },
    ): Promise<SurveyMediaUploadResult> {
      // 写操作：按宿主授权判定（主站 resolveAccess：viewer → 403）。
      await requireSurveyAccess(userId, surveyId, "write");
      // 字节嗅探 + 大小闸在这里（不在路由）：mime 权威值来自嗅探，永不采信客户端。
      const validated = assertSurveyImageUpload(input.buffer, SURVEY_MEDIA_MAX_BYTES);
      const sha256 = createHash("sha256").update(validated.bytes).digest("hex");
      // put 与绑定入库同锁：与删除侧 GC（绑定检查 + 物理删除）互斥，防止
      // 同内容重传落在 GC 判定与删除之间留下「有绑定无字节」。
      const { put: upload, row } = await withMediaShaLock(sha256, async () => {
        const put = await media.put(validated.bytes, validated.mime);
        const row = await storage.createMediaBinding({
          surveyId,
          userId,
          fileSha256: put.sha256,
          name: safeName(input.filename),
        });
        return { put, row };
      });
      return {
        id: row.id,
        surveyId,
        name: row.name,
        sha256: upload.sha256,
        mime: upload.mime,
        bytes: upload.bytes,
        createdAt: row.createdAt,
        url: `/api/surveys/${surveyId}/media/${row.id}`,
      };
    },

    /** 草稿期读取（编辑器/预览）：按问卷读权限放行，文件必须绑定在本问卷。
     *  <img> 带不了宿主身份头：身份按资源归属锁定后再走常规判定（宿主 port）。 */
    async getSurveyMediaBytes(
      userId: string,
      surveyId: string,
      fileId: string,
    ): Promise<{ buffer: Buffer; mime: string } | null> {
      const owned = await storage.findById(surveyId, { excludeDeleted: true });
      if (!owned) return null;
      return auth.runInResourceSpace(owned.teamId, async () => {
        try {
          await requireSurveyAccess(userId, surveyId, "read");
        } catch {
          return null;
        }
        const row = await storage.findMediaBinding(fileId, surveyId);
        if (!row) return null;
        return media.get(row.fileSha256);
      });
    },

    /**
     * 公开资产面（无身份）：放行条件 = 该 fileId 有绑定行（作者上传的证据），
     * 且被任一已发布快照的定义引用——draftJson 不是快照，未发布的引用冒充不了。
     * 旧版本快照引用的图在问卷存续期内继续可读（已有作答者看到的页面不能裂图）。
     */
    async getPublicSurveyAsset(
      fileId: string,
    ): Promise<{ buffer: Buffer; mime: string } | null> {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)
      )
        return null;
      const sha = await storage.findPublishedAssetSha(fileId);
      if (!sha) return null;
      return media.get(sha);
    },
  };
}

export type SurveysMedia = ReturnType<typeof createSurveysMedia>;
export { InvalidUploadError };
