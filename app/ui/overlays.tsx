"use client";

import { Drawer, Modal } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";

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

function modalClasses(classNames: OverlayClassNames | undefined, scrollMode: ScrollMode, draggable: boolean) {
  return {
    ...classNames,
    content: classes("ws-overlay-surface", "ws-modal-content", "ws-responsive-modal", draggable && "ws-modal-draggable", classNames?.content),
    header: classes("ws-overlay-header", "ws-modal-header", draggable && "ws-modal-drag-handle", classNames?.header),
    body: classes("ws-overlay-body", scrollMode === "body" ? "ws-overlay-body--scroll" : "ws-overlay-body--contained", classNames?.body),
  };
}

type DragPosition = { x: number; y: number };

function viewportSafeDelta(bounds: DOMRect, deltaX: number, deltaY: number) {
  const safeGap = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--overlay-safe-gap")) || 8;
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  return {
    x: Math.min(Math.max(deltaX, safeGap - bounds.left), width - safeGap - bounds.right),
    y: Math.min(Math.max(deltaY, safeGap - bounds.top), height - safeGap - bounds.bottom),
  };
}

function useModalDrag(opened: boolean, enabled: boolean) {
  const [position, setPosition] = useState<DragPosition>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const positionRef = useRef(position);
  const dragRef = useRef<{
    bounds: DOMRect;
    origin: DragPosition;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);

  const moveTo = useCallback((next: DragPosition) => {
    positionRef.current = next;
    setPosition(next);
  }, []);

  const reset = useCallback(() => moveTo({ x: 0, y: 0 }), [moveTo]);

  useEffect(() => {
    dragRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      reset();
      setDragging(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, opened, reset]);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, [enabled, reset]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0 || event.pointerType === "touch") return;
    const surface = event.currentTarget.closest<HTMLElement>(".ws-modal-content");
    if (!surface) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      bounds: surface.getBoundingClientRect(),
      origin: positionRef.current,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    setDragging(true);
  }, [enabled]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const delta = viewportSafeDelta(drag.bounds, event.clientX - drag.startX, event.clientY - drag.startY);
    moveTo({ x: drag.origin.x + delta.x, y: drag.origin.y + delta.y });
  }, [moveTo]);

  const stopDragging = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDragging(false);
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!enabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const surface = event.currentTarget.closest<HTMLElement>(".ws-modal-content");
    if (!surface) return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 10;
    const requested = {
      x: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
      y: event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
    };
    const delta = viewportSafeDelta(surface.getBoundingClientRect(), requested.x, requested.y);
    moveTo({ x: positionRef.current.x + delta.x, y: positionRef.current.y + delta.y });
  }, [enabled, moveTo]);

  return {
    dragging,
    position,
    reset,
    titleProps: { onKeyDown, onPointerCancel: stopDragging, onPointerDown, onPointerMove, onPointerUp: stopDragging },
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
  style,
  title,
  ...props
}: ResponsiveModalProps) {
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const finePointer = useMediaQuery("(hover: hover) and (pointer: fine)") ?? false;
  const useFullScreen = fullScreen ?? (mobileFullScreen && compact);
  // A wide touch viewport can be a phone in landscape, not a desktop.
  const draggable = !useFullScreen && finePointer;
  const drag = useModalDrag(props.opened, draggable);
  return <Modal
    {...props}
    data-ui-overlay="modal"
    data-ui-draggable={draggable ? "true" : "false"}
    data-ws-dragging={drag.dragging ? "true" : undefined}
    centered={centered ?? !useFullScreen}
    fullScreen={useFullScreen}
    classNames={modalClasses(classNames, scrollMode, draggable)}
    overlayProps={{ backgroundOpacity: 0.42, blur: 2, ...overlayProps }}
    style={[style, {
      "--ws-modal-drag-x": `${drag.position.x}px`,
      "--ws-modal-drag-y": `${drag.position.y}px`,
    }]}
    title={draggable && title ? <div
      {...drag.titleProps}
      aria-description="可拖动窗口；使用方向键也可移动，双击恢复居中。"
      className="ws-modal-drag-title"
      onDoubleClick={drag.reset}
      tabIndex={0}
      title="拖动窗口（也可用方向键移动）"
    >{title}</div> : title}
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
