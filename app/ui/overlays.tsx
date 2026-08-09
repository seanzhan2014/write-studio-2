"use client";

import { Drawer, Modal } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { ComponentProps, ReactNode } from "react";

type OverlayClassNames = Partial<Record<
  "root" | "overlay" | "inner" | "content" | "header" | "title" | "close" | "body",
  string
>>;

type ScrollMode = "body" | "content";
type DrawerBaseProps = ComponentProps<typeof Drawer>;
type ModalBaseProps = ComponentProps<typeof Modal>;

function classes(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

function drawerClasses(classNames: OverlayClassNames | undefined, scrollMode: ScrollMode) {
  return {
    ...classNames,
    content: classes("ws-overlay-surface", "ws-drawer-content", "ws-scrollable-drawer", classNames?.content),
    header: classes("ws-overlay-header", "ws-drawer-header", classNames?.header),
    body: classes("ws-overlay-body", scrollMode === "body" ? "ws-overlay-body--scroll" : "ws-overlay-body--contained", classNames?.body),
  };
}

function modalClasses(classNames: OverlayClassNames | undefined, scrollMode: ScrollMode) {
  return {
    ...classNames,
    content: classes("ws-overlay-surface", "ws-modal-content", "ws-responsive-modal", classNames?.content),
    header: classes("ws-overlay-header", "ws-modal-header", classNames?.header),
    body: classes("ws-overlay-body", scrollMode === "body" ? "ws-overlay-body--scroll" : "ws-overlay-body--contained", classNames?.body),
  };
}

export type ScrollableDrawerProps = Omit<DrawerBaseProps, "classNames"> & {
  classNames?: OverlayClassNames;
  scrollMode?: ScrollMode;
};

export function ScrollableDrawer({ classNames, overlayProps, scrollMode = "body", ...props }: ScrollableDrawerProps) {
  return <Drawer
    {...props}
    data-ui-overlay="drawer"
    classNames={drawerClasses(classNames, scrollMode)}
    overlayProps={{ backgroundOpacity: 0.42, blur: 2, ...overlayProps }}
  />;
}

export type ResponsiveModalProps = Omit<ModalBaseProps, "classNames"> & {
  classNames?: OverlayClassNames;
  mobileFullScreen?: boolean;
  scrollMode?: ScrollMode;
};

export function ResponsiveModal({
  centered,
  classNames,
  fullScreen,
  mobileFullScreen = true,
  overlayProps,
  scrollMode = "body",
  ...props
}: ResponsiveModalProps) {
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const useFullScreen = fullScreen ?? (mobileFullScreen && compact);
  return <Modal
    {...props}
    data-ui-overlay="modal"
    centered={centered ?? !useFullScreen}
    fullScreen={useFullScreen}
    classNames={modalClasses(classNames, scrollMode)}
    overlayProps={{ backgroundOpacity: 0.42, blur: 2, ...overlayProps }}
  />;
}

export type ActionSheetItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  className?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export type MobileActionSheetProps = {
  actions: ActionSheetItem[];
  ariaLabel: string;
  closeLabel: string;
  eyebrow: string;
  onClose: () => void;
  title: ReactNode;
  classNames?: { content?: string; body?: string; list?: string };
  closeAfterSelect?: boolean;
  responsiveDesktopMenu?: boolean;
};

function ActionSheetTitle({ eyebrow, title }: Pick<MobileActionSheetProps, "eyebrow" | "title">) {
  return <div className="ws-overlay-title"><span>{eyebrow}</span><span className="ui-title">{title}</span></div>;
}

function ActionSheetButtons({ actions, closeAfterSelect, listClassName, onClose }: {
  actions: ActionSheetItem[];
  closeAfterSelect: boolean;
  listClassName?: string;
  onClose: () => void;
}) {
  return <div className={classes("ws-action-sheet-list", listClassName)} data-ui-overlay-scroll>
    {actions.map((action) => <button
      className={classes(action.className, action.danger && "danger")}
      disabled={action.disabled}
      key={action.key}
      type="button"
      onClick={() => {
        action.onSelect();
        if (closeAfterSelect) onClose();
      }}
    >{action.icon && <span className="ws-action-sheet-icon">{action.icon}</span>}<span>{action.label}</span></button>)}
  </div>;
}

export function MobileActionSheet({
  actions,
  ariaLabel,
  classNames,
  closeAfterSelect = true,
  closeLabel,
  eyebrow,
  onClose,
  responsiveDesktopMenu = false,
  title,
}: MobileActionSheetProps) {
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  if (responsiveDesktopMenu && !compact) {
    return <div className="ws-action-sheet-layer" data-ui-overlay="action-sheet">
      <button className="modal-scrim" type="button" aria-label={closeLabel} onClick={onClose} />
      <aside className={classes("ws-action-sheet", "ws-action-sheet--desktop", classNames?.content)} role="dialog" aria-modal="true" aria-label={ariaLabel}>
        <header className="ws-overlay-header"><ActionSheetTitle eyebrow={eyebrow} title={title} /></header>
        <ActionSheetButtons actions={actions} closeAfterSelect={closeAfterSelect} listClassName={classNames?.list} onClose={onClose} />
      </aside>
    </div>;
  }
  return <ScrollableDrawer
    opened
    onClose={onClose}
    scrollMode="content"
    closeButtonProps={{ "aria-label": closeLabel }}
    title={<ActionSheetTitle eyebrow={eyebrow} title={title} />}
    position="bottom"
    size="auto"
    classNames={{
      content: classes("ws-action-sheet", "ws-action-sheet--mobile", classNames?.content),
      body: classes("ws-action-sheet-body", classNames?.body),
    }}
  >
    <ActionSheetButtons actions={actions} closeAfterSelect={closeAfterSelect} listClassName={classNames?.list} onClose={onClose} />
  </ScrollableDrawer>;
}
