import type { HTMLAttributes } from "react";

export interface ToolstripProps extends HTMLAttributes<HTMLDivElement> {
  float?: boolean;
}

export function Toolstrip({ float = false, className, ...rest }: ToolstripProps) {
  return <div className={`toolstrip${float ? " toolstrip-float" : ""}${className ? ` ${className}` : ""}`} {...rest} />;
}

export function ToolstripSep() {
  return <span className="toolstrip-sep" aria-hidden="true" />;
}
