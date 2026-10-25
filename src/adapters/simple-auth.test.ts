import { describe, expect, it, vi } from "vitest";
import type { SurveysStoragePort } from "../ports.js";
import {
  createSimpleAuth,
  STANDALONE_ADMIN_USER_ID,
  standaloneAdminActor,
} from "./simple-auth.js";

const surveyId = "00000000-0000-4000-8000-000000000001";

function setup(row: { userId: string } | null) {
  const findById = vi.fn(async () => row);
  const auth = createSimpleAuth({ findById } as unknown as SurveysStoragePort);
  return { auth, findById };
}

describe("simple-auth 创建者策略", () => {
  it("创建者对资源全权，且只认未删除的行", async () => {
    const { auth, findById } = setup({ userId: STANDALONE_ADMIN_USER_ID });
    await expect(auth.resolveResourceAccess("admin", surveyId)).resolves.toEqual({
      canRead: true,
      canWrite: true,
      canDelete: true,
    });
    expect(findById).toHaveBeenCalledWith(surveyId, { excludeDeleted: true });
  });

  it("非创建者全拒", async () => {
    const { auth } = setup({ userId: "someone-else" });
    await expect(auth.resolveResourceAccess("admin", surveyId)).resolves.toEqual({
      canRead: false,
      canWrite: false,
      canDelete: false,
    });
  });

  it("缺失或已删除的问卷全拒", async () => {
    const { auth } = setup(null);
    await expect(auth.resolveResourceAccess("admin", surveyId)).resolves.toEqual({
      canRead: false,
      canWrite: false,
      canDelete: false,
    });
  });

  it("team 空间恒拒", async () => {
    const { auth } = setup({ userId: STANDALONE_ADMIN_USER_ID });
    await expect(
      auth.resolveSpaceAccess("admin", { kind: "team", teamId: "team-1" }),
    ).resolves.toEqual({ canRead: false, canWrite: false });
  });

  it("personal 空间允许", async () => {
    const { auth } = setup(null);
    await expect(auth.resolveSpaceAccess("admin", { kind: "personal" })).resolves.toEqual({
      canRead: true,
      canWrite: true,
    });
  });

  it("默认 actor 是管理员的 personal 空间", () => {
    expect(standaloneAdminActor()).toEqual({
      userId: STANDALONE_ADMIN_USER_ID,
      space: { kind: "personal" },
    });
  });
});
