import type { NoviceTask } from "./schema.js";

// 新手端到端任务（主控撰写）：评测「模糊想法 → 设计说明 → 问卷草稿」全链
// 路时以 initialPrompt 为起点，expectedClarifications 是 Copilot 追问的下
// 限（漏问则关键未知会被静默编造，违反阶段 2 验收）。
export const noviceTasks: NoviceTask[] = [
  {
    id: "task.grad_ai_usage",
    title: "研究生 AI 工具使用现状",
    scenario: "文科研究生做课程调研，第一次设计问卷，没有方法课基础。",
    initialPrompt: "帮我做个问卷，看看现在研究生用 AI 工具写文献综述的情况。",
    expectedClarifications: [
      {
        topic: "目标人群边界",
        sampleQuestion: "你想了解的是你自己专业的同学，还是更大范围的研究生？范围越大、发散越难收。",
      },
      {
        topic: "时间口径",
        sampleQuestion: "你说「现在」是指本学期，还是过去一年都算？",
      },
      {
        topic: "招募渠道与规模",
        sampleQuestion: "你打算把链接发到哪里收答卷？大概能收到多少份？",
      },
      {
        topic: "用途",
        sampleQuestion: "这份问卷是课程作业、开题依据还是打算发表？对严谨度的要求不一样。",
      },
      {
        topic: "「用 AI 工具」的操作定义",
        sampleQuestion: "你关心的是哪些工具、用到什么程度算「用」（检索、总结、改写都算吗）？",
      },
    ],
    expectedResearchType: "status_survey",
    successCriteria: [
      "设计说明里写明人群边界、时间口径与「使用」的操作定义，没有沿用模糊原话。",
      "每道题都能对应到「使用现状」的一个具体指标，无与研究问题无关的凑数题。",
      "便利样本的局限（不能推断全体研究生）出现在设计说明里，而不是等分析时才暴露。",
    ],
  },
  {
    id: "task.program_satisfaction",
    title: "专硕学硕培养满意度比较",
    scenario: "学院教务老师想了解两类培养方式的学生满意度差异，用于培养方案修订汇报。",
    initialPrompt: "我想调查一下专硕和学硕学生对培养方案的满意度，比较一下两边差多少。",
    expectedClarifications: [
      {
        topic: "分组定义",
        sampleQuestion: "专硕/学硕按学籍划分就行，还是有一年制、非全这类需要单列的情况？",
      },
      {
        topic: "满意度的方面",
        sampleQuestion: "「满意度」你更关心课程、导师指导、实践机会还是整体？都需要还是挑重点？",
      },
      {
        topic: "每组样本来源",
        sampleQuestion: "两个项目的学生你都能触达到吗？各大概能收多少份？",
      },
      {
        topic: "结果用途与表述边界",
        sampleQuestion: "汇报里看到数字有差距，你需要说「有显著差异」吗？（当前分析只能描述差距大小）",
      },
    ],
    expectedResearchType: "group_comparison",
    successCriteria: [
      "分组变量与研究说明中的分组口径一致，且作为题目进卷（不能事后靠外部名单对回）。",
      "比较的方面在设计阶段预先声明，不是采完随意挑差距大的比。",
      "设计说明明确：非随机分组 + 无显著性检验，结论只能描述差异并说明选择偏差风险。",
    ],
  },
  {
    id: "task.open_science_attitude",
    title: "课题组开放科学认同度量表",
    scenario: "理工科导师想了解课题组研究生对开放科学实践的态度，考虑推动数据共享。",
    initialPrompt: "帮我做个小量表，测测我们组学生对开放科学的认同程度，比如数据共享、预注册这些。",
    expectedClarifications: [
      {
        topic: "构念维度",
        sampleQuestion: "你提到的数据共享、预注册之外，开源代码、公开数据这些也要覆盖吗？你心里的「认同」具体指行为意愿还是价值态度？",
      },
      {
        topic: "量表来源",
        sampleQuestion: "有没有你了解的现成量表想沿用或改编？没有的话这版就是自拟题，需要后续验证。",
      },
      {
        topic: "刻度与反向题",
        sampleQuestion: "用 5 点还是 7 点量表？要不要掺反向题？掺了的话后续算分要手动反转。",
      },
      {
        topic: "结果用途",
        sampleQuestion: "结果是想了解整体分布，还是要和别的课题组比较？会不会用来评价个人？",
      },
    ],
    expectedResearchType: "attitude_scale",
    successCriteria: [
      "每个维度 ≥3 题且题目与维度声明一一对应（映射可查）。",
      "自拟量表不冒充已验证量表：设计说明标注「自拟，未验证」，并说明信度分析的当前限制。",
      "用于评价个人的高风险用途被追问揭示，题目措辞避免自我暴露压力（敏感题口径）。",
    ],
  },
];
