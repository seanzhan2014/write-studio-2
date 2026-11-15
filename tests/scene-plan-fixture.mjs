export function scenePlanFixture(fact = "人物核实线索后决定下一步行动。") {
  return {
    anchors: [{ id: "A1", fact, source: fact }],
    creativeSpace: "可以设计询问方式、对白与动作衔接，不新增关键身份、动机或证据。",
    unresolved: ["未给出的真实动机留白。"],
    scenes: [{ id: "S1", anchors: ["A1"], purpose: "完成既定事件并推动下一步行动。", entry: "承接前文的地点与知情状态。", goal: "核实已有线索。", obstacle: "现有信息尚不足以得出结论。", actions: "先核对已有线索，依据核对结果选择下一步行动。", outcome: fact, knowledge: "只获得行动中有依据的信息，不知道未给出的真实动机。", transition: "停在具体决定处，后场承接这一选择。", treatment: "核实与选择展开，重复过程概述，遵循关联情节的篇幅。" }],
  };
}
