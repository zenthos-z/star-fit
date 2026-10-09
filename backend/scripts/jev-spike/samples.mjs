/**
 * 意图分类测试样本集（测试 2/3 数据源）。
 *
 * 标签口径 = issue #160 场景定义：
 *   chat             自由聊天/知识咨询（plan 死路后所有自由文本都落这里的现状场景）
 *   plan             请求生成/调整/查看训练计划（L3 plan 速查表场景）
 *   workout_complete 报告完成训练/记录训练结果（训练结束自动分析、程序化触发场景）
 *   update_profile   更新个人资料/身体数据/目标/偏好（问卷回传、画像确认卡场景）
 *
 * boundary: true = 边界/歧义样本（#160 点名要求覆盖，如「我练完了」「调整我的计划」）。
 */

export const SAMPLES = [
  // ---- chat (9) ----
  { id: "chat-01", text: "今天天气不错，适合户外跑步吗？", expected: "chat" },
  { id: "chat-02", text: "蛋白质和碳水应该怎么搭配？", expected: "chat" },
  { id: "chat-03", text: "卧推和俯卧撑哪个练胸效果好？", expected: "chat" },
  { id: "chat-04", text: "我今天心情不太好", expected: "chat" },
  { id: "chat-05", text: "你好，你都能帮我做什么？", expected: "chat" },
  { id: "chat-06", text: "增肌期间可以喝酒吗", expected: "chat" },
  { id: "chat-07", text: "What's the best time of day to work out?", expected: "chat" },
  { id: "chat-08", text: "深蹲的时候膝盖到底能不能超过脚尖啊", expected: "chat" },
  { id: "chat-09", text: "讲个笑话听听", expected: "chat" },

  // ---- plan (9) ----
  { id: "plan-01", text: "帮我做一份增肌计划", expected: "plan" },
  { id: "plan-02", text: "下周练什么？", expected: "plan" },
  { id: "plan-03", text: "我要备战马拉松，帮我排一个12周的跑步计划", expected: "plan" },
  { id: "plan-04", text: "给我安排一个每周四练的分化训练", expected: "plan" },
  { id: "plan-05", text: "我是新手，帮我制定入门训练方案", expected: "plan" },
  { id: "plan-06", text: "调整我的计划，这周改成练三天", expected: "plan", boundary: true, note: "#160 点名：plan vs profile 边界——改的是计划排期而非画像" },
  { id: "plan-07", text: "帮我换个计划，现在这个太累了", expected: "plan" },
  { id: "plan-08", text: "计划里的硬拉换成罗马尼亚硬拉", expected: "plan", boundary: true, note: "修改计划内容（动作替换），容易误判 update_profile" },
  { id: "plan-09", text: "给我生成一个减脂的训练计划，我家里只有一对哑铃", expected: "plan" },

  // ---- workout_complete (9) ----
  { id: "wc-01", text: "我练完了", expected: "workout_complete", boundary: true, note: "#160 点名歧义样本：无宾语，可能是宣告完成也可能是请求分析" },
  { id: "wc-02", text: "今天的训练做完了，卧推80kg做了5组每组5个", expected: "workout_complete" },
  { id: "wc-03", text: "刚跑完10公里，用时52分钟", expected: "workout_complete" },
  { id: "wc-04", text: "深蹲练了5组，每组8个，100公斤", expected: "workout_complete" },
  { id: "wc-05", text: "训练结束，帮我分析一下今天的表现", expected: "workout_complete" },
  { id: "wc-06", text: "今天没做完，做了一半就没力了", expected: "workout_complete", boundary: true, note: "未完成也算训练回传（部分完成）" },
  { id: "wc-07", text: "我昨天练了背，感觉还挺不错的", expected: "workout_complete", boundary: true, note: "过去式复盘式回传，容易被判 chat" },
  { id: "wc-08", text: "打卡，今日臀腿日完成✅", expected: "workout_complete" },
  { id: "wc-09", text: "just finished my workout, feeling great", expected: "workout_complete" },

  // ---- update_profile (9) ----
  { id: "up-01", text: "我的体重现在是75公斤了，帮我更新一下", expected: "update_profile" },
  { id: "up-02", text: "把我的目标从减脂改成增肌", expected: "update_profile", boundary: true, note: "#160 点名：plan vs profile 边界——出现「增肌」但意图是改画像目标" },
  { id: "up-03", text: "我今年28岁，身高178", expected: "update_profile" },
  { id: "up-04", text: "我最近膝盖有伤，深蹲相关的先不要给我安排", expected: "update_profile", boundary: true, note: "约束偏好更新 vs 计划调整边界" },
  { id: "up-05", text: "更新一下我的资料，我一星期可以练4天了", expected: "update_profile" },
  { id: "up-06", text: "我不吃鸡蛋，还有点乳糖不耐", expected: "update_profile" },
  { id: "up-07", text: "我现在的卧推极限到100公斤了", expected: "update_profile", boundary: true, note: "能力数据回传 vs 训练记录边界" },
  { id: "up-08", text: "我只有周末有空练了", expected: "update_profile", boundary: true, note: "可用时间变化=画像更新，无「计划」字面触发词" },
  { id: "up-09", text: "静息心率降到55了，最近恢复得不错", expected: "update_profile" },
];

/** 按标签计数校验样本集平衡性。 */
export function sampleStats() {
  const byLabel = {};
  for (const s of SAMPLES) byLabel[s.expected] = (byLabel[s.expected] ?? 0) + 1;
  return { total: SAMPLES.length, byLabel, boundaryCount: SAMPLES.filter((s) => s.boundary).length };
}
