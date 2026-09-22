// Stable subgroup colors shared by the map and the classification tree.
const groupColors = {
  austronesian: "#65566f", malayo_polynesian: "#64748b",
  ami: "#c43c39", ata: "#2878b5", say: "#a56520", tha: "#008b8b",
  sed: "#7755aa", bun: "#398044", pai: "#d56820", ruk: "#b13e83",
  trv: "#5268c4", kav: "#817b1d", tso: "#7b4935", knv: "#c45573",
  hla: "#586b38", yam: "#007eaa", sak: "#a944bb", puy: "#278574",
};

export function groupColor(id) {
  return groupColors[id] || "#6b7280";
}
