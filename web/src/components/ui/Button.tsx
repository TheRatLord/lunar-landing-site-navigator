import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { Tooltip } from "./Tooltip";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost";
  size?: "sm" | "md";
  icon?: IconName;
  shortcut?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", icon, shortcut: _shortcut, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={`btn btn-${variant} btn-${size} ${className ?? ""}`} {...rest}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "children"> {
  icon: IconName;
  label: string;
  pressed?: boolean;
  children?: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, shortcut, pressed, variant = "ghost", size = "md", className, ...rest },
  ref,
) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        className={`btn btn-icon btn-${variant} btn-${size} ${className ?? ""}`}
        {...rest}
      >
        <Icon name={icon} size={size === "sm" ? 14 : 16} />
      </button>
    </Tooltip>
  );
});
