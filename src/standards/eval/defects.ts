import type { DefectCase } from "./schema.js";

// 典型缺陷案例（wave2 填充）：≥8 例、planted ≥12 条、覆盖 ≥5 个维度。
// 每例结构完全合法，缺陷只在方法学层面；planted 的 checkId 均为目录实有条目。
export const defectCases: DefectCase[] = [
  {
    id: "defect.vague_goal_tool_survey",
    researchType: "status_survey",
    title: "科研工具使用现状（目标与措辞缺陷）",
    definition: {
      version: 1,
      title: "科研工具使用现状调查",
      description: "",
      consent: "本问卷仅用于学术研究，作答自愿，可随时退出。",
      questions: [
        {
          id: "q2",
          type: "single",
          title: "你使用文献管理工具和数据分析工具的频率是？",
          required: true,
          options: [
            { id: "never", label: "从不" },
            { id: "rarely", label: "偶尔" },
            { id: "often", label: "经常" },
            { id: "always", label: "总是" },
          ],
        },
        {
          id: "q3",
          type: "single",
          title: "你在科研中经常使用 LLM 吗？",
          required: true,
          options: [
            { id: "yes", label: "是" },
            { id: "no", label: "否" },
            { id: "unsure", label: "不确定" },
          ],
        },
        {
          id: "q4",
          type: "single",
          title: "你平时主要采用哪种通勤方式？",
          required: false,
          options: [
            { id: "walk", label: "步行" },
            { id: "bike", label: "骑行" },
            { id: "bus", label: "公交" },
            { id: "car", label: "自驾" },
            { id: "other", label: "其他" },
          ],
        },
        {
          id: "q5",
          type: "single",
          title: "你目前的年级是？",
          required: true,
          options: [
            { id: "y1", label: "研一" },
            { id: "y2", label: "研二" },
            { id: "y3", label: "研三" },
            { id: "phd", label: "博士" },
          ],
        },
        {
          id: "q6",
          type: "text",
          title: "请补充你在科研工具使用中遇到的其他问题",
          required: false,
          multiline: true,
        },
      ],
      pages: [
        {
          id: "p1",
          title: "科研工具使用",
          description:
            "本问卷旨在了解大家对科研工具的看法，为改进科研支持提供参考。",
          questionIds: ["q2", "q3", "q4", "q5", "q6"],
        },
      ],
    },
    planted: [
      {
        checkId: "research_goal.vague_objective",
        at: "pages.0",
        note: "页说明里的目标没有目标人群、具体构念与用途边界，「看法」可指态度、使用或需求，无法据此决定题目与结论范围。",
      },
      {
        checkId: "wording.double_barrel",
        at: "q2",
        note: "一道题同时问文献管理工具与数据分析工具两个可独立评价的对象，用一个频率无法给出可解释答案。",
      },
      {
        checkId: "wording.timeframe",
        at: "q2",
        note: "频率题没有回忆期，有人按周、有人按学期理解，作答分布不可比。",
      },
      {
        checkId: "wording.vague_terms",
        at: "q3",
        note: "面向普通研究生的题干直接用缩写 LLM，且「经常」无锚点，不理解缩写的受访者只能猜答。",
      },
      {
        checkId: "coverage.item_relevance",
        at: "q4",
        note: "通勤方式与科研工具使用构念无关，也不进入任何分析，只增加作答负担。",
      },
    ],
    mustNotFlag: [
      {
        checkId: "coverage.item_relevance",
        note: "q5 的年级用于分层描述，属设计内背景变量，不属于应删除的无关题。",
      },
      {
        checkId: "wording.double_barrel",
        note: "q3 只问生成式 AI 这一个对象，「辅助科研」是使用场景限定而非并列评价对象，不按双重提问上报。",
      },
    ],
  },
  {
    id: "defect.group_missing_variable",
    researchType: "group_comparison",
    title: "专硕与学硕实习负担比较（缺分组变量）",
    definition: {
      version: 1,
      title: "研究生实习负担调查",
      description: "",
      consent: "本问卷匿名，数据仅用于研究，可随时退出。",
      questions: [
        {
          id: "q1",
          type: "single",
          title: "你目前的年级是？",
          required: true,
          options: [
            { id: "y1", label: "研一" },
            { id: "y2", label: "研二" },
            { id: "y3", label: "研三" },
          ],
        },
        {
          id: "q2",
          type: "multiple",
          title: "你在实习中遇到的主要困难有哪些？",
          required: false,
          options: [
            { id: "time", label: "与科研时间冲突" },
            { id: "commute", label: "通勤距离远" },
            { id: "mismatch", label: "任务与专业无关" },
            { id: "mentor", label: "缺乏指导" },
            { id: "other", label: "其他" },
          ],
        },
        {
          id: "q3",
          type: "scale",
          title: "你感到的实习负担有多重？",
          required: true,
          min: 1,
          max: 5,
          minLabel: "很轻",
          maxLabel: "很重",
        },
        {
          id: "q4",
          type: "text",
          title: "关于实习安排，你还有什么想补充的？",
          required: false,
          multiline: true,
        },
      ],
      pages: [
        {
          id: "p1",
          title: "实习负担",
          description:
            "本调查通过学院微信群随机抽取 300 名研究生，结果可代表全国研究生情况。",
          questionIds: ["q1", "q2", "q3", "q4"],
        },
      ],
    },
    planted: [
      {
        checkId: "coverage.missing_group_variable",
        at: "q1",
        note: "研究目标是专硕与学硕比较，问卷只采年级，无法还原学位类型，交叉表没有分组的分母。",
      },
      {
        checkId: "coverage.unmeasured_confounder",
        at: "q1",
        note: "未采集实习经历与项目资源等替代解释变量，观察到的组间负担差无法与选择偏差区分。",
      },
      {
        checkId: "sampling_recruitment.convenience_disclosure",
        at: "pages.0",
        note: "社群转发属便利样本，却写成「随机抽取」并声称代表全国，混淆了抽样方式与结论边界。",
      },
      {
        checkId: "sampling_recruitment.group_reach",
        at: "pages.0",
        note: "只在单一学院群招募，却计划比较研一到研三三组，未核对各组可触达样本量。",
      },
    ],
    mustNotFlag: [
      {
        checkId: "wording.leading",
        note: "q3 只问负担轻重，量表两端对称，未预设实习有害的立场，不按诱导措辞上报。",
      },
    ],
  },
  {
    id: "defect.self_efficacy_scale",
    researchType: "attitude_scale",
    title: "科研自我效能感量表（维度与冗余题）",
    definition: {
      version: 1,
      title: "研究生科研自我效能感调查",
      description: "",
      consent: "本问卷匿名，作答自愿。",
      questions: [
        {
          id: "q1",
          type: "scale",
          title: "我能独立完成一篇文献综述",
          required: true,
          min: 1,
          max: 5,
          minLabel: "非常不同意",
          maxLabel: "非常同意",
        },
        {
          id: "q2",
          type: "scale",
          title: "我相信自己可以写好文献综述",
          required: true,
          min: 1,
          max: 5,
          minLabel: "非常不同意",
          maxLabel: "非常同意",
        },
        {
          id: "q3",
          type: "scale",
          title: "写文献综述对我而言很轻松",
          required: true,
          min: 1,
          max: 5,
          minLabel: "非常不同意",
          maxLabel: "非常同意",
        },
        {
          id: "q4",
          type: "matrix_single",
          title: "请评价以下说法与你的符合程度",
          required: true,
          rows: [
            { id: "r1", label: "我擅长使用新工具" },
            { id: "r2", label: "我乐于尝试新工具" },
          ],
          columns: [
            { id: "c1", label: "非常不同意" },
            { id: "c2", label: "不同意" },
            { id: "c3", label: "中立" },
            { id: "c4", label: "同意" },
            { id: "c5", label: "非常同意" },
          ],
        },
        {
          id: "q5",
          type: "statement",
          title: "量表说明",
          required: false,
          body: "以下三道题沿用某已验证科研自我效能感量表的原始同意度格式，未作改写。",
        },
        {
          id: "q6",
          type: "scale",
          title: "我能快速找到研究所需的文献",
          required: true,
          min: 1,
          max: 5,
          minLabel: "非常不同意",
          maxLabel: "非常同意",
        },
        {
          id: "q7",
          type: "scale",
          title: "我能判断一篇文献的质量",
          required: true,
          min: 1,
          max: 5,
          minLabel: "非常不同意",
          maxLabel: "非常同意",
        },
        {
          id: "q8",
          type: "scale",
          title: "我能把文献整合成综述框架",
          required: true,
          min: 1,
          max: 5,
          minLabel: "非常不同意",
          maxLabel: "非常同意",
        },
      ],
      pages: [
        { id: "p1", title: "自我效能感", questionIds: ["q1", "q2", "q3", "q4"] },
        { id: "p2", title: "量表续", questionIds: ["q5", "q6", "q7", "q8"] },
      ],
    },
    planted: [
      {
        checkId: "coverage.construct_dimensions",
        at: "q1",
        note: "三个题项都只测文献综述，数据分析与论文写作等维度整体缺席，结论却以科研自我效能感整体名义呈现。",
      },
      {
        checkId: "coverage.redundant_items",
        at: "q2",
        note: "q2 只是把 q1 的「完成」换成「写好」，问的是同一表现，合成后 α 虚高但覆盖未增加。",
      },
      {
        checkId: "coverage.redundant_items",
        at: "q3",
        note: "q3 换成情绪化表述「很轻松」，仍调用同一段记忆与判断，与 q1、q2 不产出不同信息。",
      },
      {
        checkId: "wording.acquiescence",
        at: "q4",
        note: "自拟态度题用同意度矩阵承载单侧陈述，可提示默许风险，但不能仅因同意度格式认定严重缺陷。",
      },
    ],
    mustNotFlag: [
      {
        checkId: "wording.acquiescence",
        note: "q6-q8 不因同意度格式自动判错；q5 的无名量表声明仍缺可核验来源，不能据此证明量表已验证。",
      },
      {
        checkId: "wording.timeframe",
        note: "q6-q8 测量稳定态度而非行为频率，按该条 appliesTo 不需要回忆期。",
      },
    ],
  },
  {
    id: "defect.sensitive_academic_misconduct",
    researchType: "status_survey",
    title: "学术行为与压力调查（敏感题与预设前提）",
    definition: {
      version: 1,
      title: "学术行为与压力调查",
      description: "本问卷所有题目均为必答，请完整填写后提交。",
      consent: "本问卷完全匿名，数据仅用于研究。",
      questions: [
        {
          id: "q1",
          type: "single",
          title: "你抄袭过别人的论文吗？",
          required: true,
          options: [
            { id: "yes", label: "是" },
            { id: "no", label: "否" },
          ],
        },
        {
          id: "q2",
          type: "text",
          title: "你使用 ChatGPT 写文献综述时遇到的主要困难是什么？",
          required: true,
          multiline: true,
        },
        {
          id: "q3",
          type: "matrix_single",
          title: "请评价以下说法与你的符合程度",
          required: true,
          rows: [{ id: "r1", label: "你不认为导师没有义务逐句修改你的论文" }],
          columns: [
            { id: "c1", label: "非常不同意" },
            { id: "c2", label: "不同意" },
            { id: "c3", label: "中立" },
            { id: "c4", label: "同意" },
            { id: "c5", label: "非常同意" },
          ],
        },
        {
          id: "q4",
          type: "number",
          title: "过去一学期你参加学术讲座的次数",
          required: true,
          min: 0,
          max: 200,
        },
      ],
      pages: [
        {
          id: "p1",
          title: "学术行为",
          questionIds: ["q1", "q2", "q3", "q4"],
        },
      ],
    },
    planted: [
      {
        checkId: "wording.social_desirability",
        at: "q1",
        note: "直陈式询问本人学术不端且必答，匿名承诺也压不住羞耻感，否认率会明显高于真实率。",
      },
      {
        checkId: "wording.presumptive",
        at: "q2",
        note: "未先筛是否使用过生成式 AI，没用过的人被迫在困难里挑一个，困难分布混入编造作答。",
      },
      {
        checkId: "wording.double_negative",
        at: "q3",
        note: "题干叠加「不认为……没有」，受访者要翻转两次才能还原句义，作答极易反向。",
      },
      {
        checkId: "analysis_fit.required_missing_design",
        at: "description",
        note: "全卷强制必答，敏感题没有跳过或「不愿回答」通道，拒答被转成编造，缺失机制未设计。",
      },
    ],
    mustNotFlag: [
      {
        checkId: "wording.double_barrel",
        note: "q3 只评价「导师逐句修改论文」这一件事，否定叠加不是两个并列对象，不按双重提问上报。",
      },
    ],
  },
  {
    id: "defect.teacher_language_ability",
    researchType: "status_survey",
    title: "县域中学教师科研能力调查（语言与构念）",
    definition: {
      version: 1,
      title: "中学教师科研能力调查",
      description: "",
      consent: "本问卷匿名，作答自愿。",
      questions: [
        {
          id: "q1",
          type: "single",
          title: "你的 research self-efficacy 水平如何？",
          required: true,
          options: [
            { id: "verylow", label: "很低" },
            { id: "low", label: "较低" },
            { id: "mid", label: "一般" },
            { id: "high", label: "较高" },
            { id: "veryhigh", label: "很高" },
          ],
        },
        {
          id: "q2",
          type: "single",
          title: "你是否主持过省级及以上课题？",
          required: true,
          options: [
            { id: "yes", label: "是" },
            { id: "no", label: "否" },
          ],
        },
        {
          id: "q3",
          type: "single",
          title: "过去三年你发表了几篇论文？",
          required: true,
          options: [
            { id: "none", label: "0 篇" },
            { id: "few", label: "1-2 篇" },
            { id: "some", label: "3-5 篇" },
            { id: "many", label: "6 篇以上" },
          ],
        },
        {
          id: "q4",
          type: "text",
          title: "请补充你对科研能力提升的其他看法",
          required: false,
          multiline: true,
        },
      ],
      pages: [
        {
          id: "p1",
          title: "科研能力",
          description:
            "拟比较县城与市区中学教师在科研能力上的差异，问卷只在县城新教师微信群发放。",
          questionIds: ["q1", "q2", "q3", "q4"],
        },
      ],
    },
    planted: [
      {
        checkId: "sampling_recruitment.language_mismatch",
        at: "q1",
        note: "面向县域中学教师却用英文术语 research self-efficacy，未做回译与目标人群认知访谈。",
      },
      {
        checkId: "coverage.construct_dimensions",
        at: "q3",
        note: "科研能力被缩成发表数量，问题提出、方法设计与协作等维度整体缺席，结论却以能力整体呈现。",
      },
      {
        checkId: "sampling_recruitment.group_reach",
        at: "pages.0",
        note: "计划比较县城与市区，却只在县城新教师群发放，市区与资深教师不可触达，未核对各组样本量。",
      },
    ],
    mustNotFlag: [
      {
        checkId: "coverage.item_relevance",
        note: "q2 的课题经历是科研能力的可操作指标之一，能进入分析，不按无关题上报。",
      },
    ],
  },
  {
    id: "defect.analysis_plan_gaps",
    researchType: "group_comparison",
    title: "工作感受调查（分析计划与变量错配）",
    definition: {
      version: 1,
      title: "科研工作感受与工具使用调查",
      description: "",
      consent: "本问卷匿名，作答自愿。",
      questions: [
        {
          id: "q1",
          type: "single",
          title: "你目前的年级是？",
          required: true,
          options: [
            { id: "y1", label: "研一" },
            { id: "y2", label: "研二" },
            { id: "y3", label: "研三" },
            { id: "phd", label: "博士" },
          ],
        },
        {
          id: "q2",
          type: "multiple",
          title: "你常用的科研工具类型有哪些？",
          required: false,
          options: [
            { id: "ref", label: "文献管理" },
            { id: "data", label: "数据分析" },
            { id: "plot", label: "绘图" },
            { id: "write", label: "写作辅助" },
          ],
        },
        {
          id: "q3",
          type: "matrix_single",
          title: "请评价你在科研工作中的以下感受",
          required: true,
          rows: [
            { id: "r1", label: "工作有意义" },
            { id: "r2", label: "时间充足" },
            { id: "r3", label: "得到支持" },
            { id: "r4", label: "压力可控" },
          ],
          columns: [
            { id: "c1", label: "非常不同意" },
            { id: "c2", label: "不同意" },
            { id: "c3", label: "中立" },
            { id: "c4", label: "同意" },
            { id: "c5", label: "非常同意" },
          ],
        },
        {
          id: "q4",
          type: "scale",
          title: "你对科研工作的投入程度",
          required: true,
          min: 1,
          max: 10,
          minLabel: "很低",
          maxLabel: "很高",
        },
        {
          id: "q5",
          type: "text",
          title: "请写出你最常用的一个科研工具名称",
          required: false,
        },
        {
          id: "q6",
          type: "statement",
          title: "分析计划",
          required: false,
          body:
            "分析计划：把「科研工作感受」四行矩阵整体与年级做交叉；多选题按选项被选次数计算比例；量表直接报告 Cronbach α 与维度得分；按 q5 的文本回答分组比较投入度；并直接比较 2024 与 2025 年的工具使用率（2024 题干为「AI 工具」，2025 改为「生成式 AI」）。",
        },
      ],
      pages: [
        {
          id: "p1",
          title: "工作感受",
          questionIds: ["q1", "q2", "q3", "q4", "q5", "q6"],
        },
      ],
    },
    planted: [
      {
        checkId: "analysis_fit.matrix_as_category",
        at: "q6",
        note: "把四行矩阵整体当作一个分类变量与年级交叉，工具里没有这种变量，合并会掩盖行间差异。",
      },
      {
        checkId: "analysis_fit.multiselect_denominator",
        at: "q6",
        note: "多选题按选项被选次数作分母，同一人多选会膨胀分母，比例不再是人群占比。",
      },
      {
        checkId: "analysis_fit.scale_without_plan",
        at: "q6",
        note: "直接报告 α 与维度得分，但未写合成规则、反向题处理与计算工具，系统也不产出这些数字。",
      },
      {
        checkId: "analysis_fit.variable_type_mismatch",
        at: "q6",
        note: "把 q5 的开放式文本当分组变量做交叉，文本未编码成有限类别，分组不可重复。",
      },
      {
        checkId: "analysis_fit.cross_time_wording_change",
        at: "q6",
        note: "两年题干由「AI 工具」改为「生成式 AI」，外延变化后直接比较使用率，变化无法与测量变化区分。",
      },
    ],
  },
  {
    id: "defect.student_pressure_consent",
    researchType: "status_survey",
    title: "学生科研压力调查（知情同意与权力关系）",
    definition: {
      version: 1,
      title: "学生科研压力调查",
      description: "请同学们课后完成本问卷，作为课程参与的一部分。",
      consent:
        "本问卷完全匿名，请填写你的学号、姓名与导师姓名，便于后续访谈联系。",
      questions: [
        {
          id: "q1",
          type: "text",
          title: "你的学号与姓名",
          required: true,
          maxLength: 100,
        },
        {
          id: "q2",
          type: "single",
          title: "你的导师是否给你造成过心理压力？",
          required: true,
          options: [
            { id: "often", label: "经常" },
            { id: "sometimes", label: "偶尔" },
            { id: "never", label: "从不" },
          ],
        },
        {
          id: "q3",
          type: "single",
          title: "你平时喜欢什么运动？",
          required: false,
          options: [
            { id: "run", label: "跑步" },
            { id: "ball", label: "球类" },
            { id: "gym", label: "健身" },
            { id: "other", label: "其他" },
          ],
        },
        {
          id: "q4",
          type: "single",
          title: "你通常多久运动一次？",
          required: false,
          options: [
            { id: "daily", label: "每天" },
            { id: "weekly", label: "每周几次" },
            { id: "monthly", label: "每月几次" },
            { id: "rare", label: "很少" },
          ],
        },
      ],
      pages: [
        {
          id: "p1",
          title: "科研压力",
          questionIds: ["q1", "q2", "q3", "q4"],
        },
      ],
    },
    planted: [
      {
        checkId: "sampling_recruitment.consent_consistency",
        at: "consent",
        note: "承诺「完全匿名」却采集学号、姓名与导师姓名，组合可直接识别到个人，同意建立在错误承诺上。",
      },
      {
        checkId: "sampling_recruitment.vulnerable_groups",
        at: "description",
        note: "任课教师向自己班级发放并计入课程参与，学生难以拒绝，「自愿」失效，须改中立渠道。",
      },
      {
        checkId: "coverage.item_relevance",
        at: "q3",
        note: "运动偏好与科研压力构念无关，也不进入分析计划，只增加作答负担。",
      },
      {
        checkId: "wording.social_desirability",
        at: "q2",
        note: "直陈式询问导师造成心理压力且必答，涉及权力关系与污名，低报与顺从风险高。",
      },
      {
        checkId: "wording.timeframe",
        at: "q4",
        note: "运动频率没有回忆期，有人按周有人按年理解，频率口径不可比。",
      },
    ],
    mustNotFlag: [
      {
        checkId: "wording.double_barrel",
        note: "q2 只问导师压力这一件事，没有并列第二个评价对象，不按双重提问上报。",
      },
    ],
  },
  {
    id: "defect.course_promo_goal",
    researchType: "status_survey",
    title: "课程效果宣传调查（目标错位）",
    definition: {
      version: 1,
      title: "课程效果反馈调查",
      description:
        "研究目标：证明本课程显著提升学生科研能力，面向广大科研工作者开展。",
      consent: "本问卷匿名自愿，结果用于课程宣传。",
      questions: [
        {
          id: "q1",
          type: "single",
          title: "本课程对你的帮助有多大？",
          required: true,
          options: [
            { id: "great", label: "很大" },
            { id: "some", label: "较大" },
            { id: "normal", label: "一般" },
          ],
        },
        {
          id: "q2",
          type: "scale",
          title: "请评价你现在的科研能力",
          required: true,
          min: 1,
          max: 10,
          minLabel: "很弱",
          maxLabel: "很强",
        },
        {
          id: "q3",
          type: "single",
          title: "你是否愿意把课程推荐给同学？",
          required: true,
          options: [
            { id: "yes", label: "愿意" },
            { id: "more", label: "非常愿意" },
          ],
        },
        {
          id: "q4",
          type: "text",
          title: "请写下课程最打动你的地方",
          required: false,
          multiline: true,
        },
      ],
      pages: [
        {
          id: "p1",
          title: "课程反馈",
          questionIds: ["q1", "q2", "q3", "q4"],
        },
      ],
    },
    planted: [
      {
        checkId: "research_goal.predetermined_conclusion",
        at: "description",
        note: "目标直接写「证明」课程有效，结论在设计阶段已锁定，问卷只保留正向评价入口。",
      },
      {
        checkId: "research_goal.question_misalignment",
        at: "q1",
        note: "要回答「是否提升能力」，却只有单次帮助度与自评，没有前后测或对照，效果问题无法由这份问卷回答。",
      },
      {
        checkId: "sampling_recruitment.population_undefined",
        at: "description",
        note: "「广大科研工作者」没有机构、阶段与时间边界，建不出抽样框，也无法判断样本偏离。",
      },
      {
        checkId: "wording.leading",
        at: "q1",
        note: "选项只有「很大/较大/一般」，没有任何负向通道，问题预设课程有帮助并引导正向作答。",
      },
      {
        checkId: "research_goal.unobservable_construct",
        at: "q2",
        note: "真实科研能力无法由一次 1-10 自评代理，测到的是自评印象而非能力本身。",
      },
    ],
    mustNotFlag: [
      {
        checkId: "wording.social_desirability",
        note: "q4 询问课程感受属常规教学反馈，敏感度低，不按敏感题社会期许上报。",
      },
    ],
  },
];
