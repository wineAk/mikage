export const colorList = {
  none: {
    bg: "bg-neutral-600",
    hoverBg: "hover:bg-neutral-600/80",
    border: "border-neutral-600",
    text: "text-white",
    oklch: "var(--color-neutral-600)",
  },
  // サスケ
  saaske00: {
    bg: "bg-lime-200",
    hoverBg: "hover:bg-lime-200/80",
    border: "border-lime-200",
    text: "text-black",
    oklch: "var(--color-lime-200)",
  },
  saaske01: {
    bg: "bg-lime-300",
    hoverBg: "hover:bg-lime-300/80",
    border: "border-lime-300",
    text: "text-black",
    oklch: "var(--color-lime-300)",
  },
  saaske02: {
    bg: "bg-lime-400",
    hoverBg: "hover:bg-lime-400/80",
    border: "border-lime-400",
    text: "text-black",
    oklch: "var(--color-lime-400)",
  },
  saaske03: {
    bg: "bg-lime-500",
    hoverBg: "hover:bg-lime-500/80",
    border: "border-lime-500",
    text: "text-black",
    oklch: "var(--color-lime-500)",
  },
  saaske04: {
    bg: "bg-lime-600",
    hoverBg: "hover:bg-lime-600/80",
    border: "border-lime-600",
    text: "text-white",
    oklch: "var(--color-lime-600)",
  },
  saaske05: {
    bg: "bg-lime-700",
    hoverBg: "hover:bg-lime-700/80",
    border: "border-lime-700",
    text: "text-white",
    oklch: "var(--color-lime-700)",
  },
  saaske07: {
    bg: "bg-lime-800",
    hoverBg: "hover:bg-lime-800/80",
    border: "border-lime-800",
    text: "text-white",
    oklch: "var(--color-lime-800)",
  },
  saaske09: {
    bg: "bg-lime-900",
    hoverBg: "hover:bg-lime-900/80",
    border: "border-lime-900",
    text: "text-white",
    oklch: "var(--color-lime-900)",
  },
  saaske_api: {
    bg: "bg-blue-300",
    hoverBg: "hover:bg-blue-300/80",
    border: "border-blue-300",
    text: "text-black",
    oklch: "var(--color-blue-300)",
  },
  // Works 
  works07: {
    bg: "bg-teal-400",
    hoverBg: "hover:bg-teal-400/80",
    border: "border-teal-400",
    text: "text-black",
    oklch: "var(--color-teal-400)",
  },
  works09: {
    bg: "bg-teal-300",
    hoverBg: "hover:bg-teal-300/80",
    border: "border-teal-300",
    text: "text-black",
    oklch: "var(--color-teal-300)",
  },
};

export function getColorListsFromKey(key: string) {
  const color = colorList[key as keyof typeof colorList] || colorList.none;
  const { bg, hoverBg, border, text, oklch } = color;
  return { bg, hoverBg, border, text, oklch };
}
