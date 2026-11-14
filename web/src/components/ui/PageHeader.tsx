import type { ReactNode } from "react";

export interface PageHeaderProps {
  tabs?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export function PageHeader({ tabs, actions, children }: PageHeaderProps) {
  return (
    <header className="page-header">
      {tabs && <div className="page-header-tabs">{tabs}</div>}
      {children && <div className="page-header-mid">{children}</div>}
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
