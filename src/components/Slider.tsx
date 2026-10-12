import type { CSSProperties, InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "min" | "max"> & {
  value: number;
  min: number;
  max: number;
};

/**
 * A range input drawn thin (index.css): the part left of the knob is filled,
 * which WebKit can't style itself, so the fill is passed in as `--fill`.
 */
export function Slider({ value, min, max, style, ...rest }: Props) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      style={{ "--fill": fill, ...style } as CSSProperties}
      {...rest}
    />
  );
}
