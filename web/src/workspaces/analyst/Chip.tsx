import type { HTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "../../components/ui/Icon";
import { Spinner } from "../../components/ui/Progress";

export type ChipTone = "default" | "pass" | "marginal" | "fail" | "live";

interface ChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  tone?: ChipTone;
  icon?: IconName;
  busy?: boolean;
  children: ReactNode;
}

export function Chip({ tone = "default", icon, busy, className, children, ...rest }: ChipProps) {
  return (
    <span className={`chip ${tone === "default" ? "" : `chip-${tone}`} ${className ?? ""}`} {...rest}>
      {busy ? <Spinner size={10} /> : icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}
