"use client";

import { useState } from "react";
import { Button } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

import { resolvedOutlineContentName, timestampContentName } from "@/lib/content-name.mjs";
import { normalizeExcellentFragments } from "@/lib/excellent-fragments.mjs";

import { currentOutlineVersion, resolvedOutlineContent } from "@/lib/outline-content";
import { outlineDisplayTitle } from "@/lib/outline-title";

import { formatTime, useStudio, wordCount, type Version } from "@/app/studio-state";

import { ScrollableDrawer } from "@/app/ui/overlays";
import { BodyDeleteDialog, type BodyDeleteTarget } from "@/app/ui/studio/body-delete-dialog";

import { resolvedExcellentFragments, directContentId, Icon, ExcellentText } from "@/app/ui/studio/shared";

import { VersionSettingSnapshotView } from "@/app/ui/studio/settings";

export function VersionDrawer({ selectedVersionId, onClose, onPreview, onClearPreview, onOpenRewriteSource, onNotice }: { selectedVersionId?: string; onClose: () => void; onPreview: (versionId: string) => void; onClearPreview: () => void; onOpenRewriteSource: (sourceId: string) => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BodyDeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const versions = studio.currentOutline.versions;
  const compareVersion = versions.find((version) => version.id === compareVersionId);
  const currentContent = resolvedOutlineContent(studio.currentOutline);
  const currentContentName = resolvedOutlineContentName(studio.currentOutline);
  const currentExcellentFragments = resolvedExcellentFragments(studio.currentOutline);
  const currentVersion = currentOutlineVersion(studio.currentOutline);
  const directPreviewSelected = selectedVersionId === directContentId(studio.currentOutline.id);
  const standaloneContent = directPreviewSelected ? studio.currentOutline.content : currentContent;
  const standaloneContentName = directPreviewSelected ? (studio.currentOutline.contentName?.trim() || timestampContentName(studio.currentOutline.updatedAt)) : currentContentName;
  const standaloneExcellentFragments = directPreviewSelected ? normalizeExcellentFragments(studio.currentOutline.content, studio.currentOutline.excellentFragments) : currentExcellentFragments;
  const showStandaloneCurrent = !currentVersion || directPreviewSelected;
  async function createBlankContent() {
    const saved = await studio.createBlankContent(studio.currentOutline.id);
    if (!saved) {
      onNotice("新建正文未完成，请查看保存状态");
      return;
    }
    onClearPreview();
    onClose();
    onNotice("已新建空白正文");
  }
  async function saveVersionAs(version: Version) {
    const defaultName = `${version.name}-复制`;
    const name = window.prompt("另存为正文版本", defaultName);
    if (name === null) return;
    const versionName = name.trim() || defaultName;
    studio.saveVersion(studio.currentOutline.id, versionName, "手动", version.content, {
      outlineSnapshot: version.outlineSnapshot,
      settingSnapshot: version.settingSnapshot,
      manualExcellent: version.manualExcellent === true,
      excellentFragments: normalizeExcellentFragments(version.content, version.excellentFragments),
    });
    const saved = await studio.saveNow();
    onNotice(saved ? `已另存为「${versionName}」` : "另存为未完成，请查看保存状态");
  }
  function requestDeleteVersion(versionId: string | null, name: string, isCurrent: boolean) {
    setDeleteTarget({ outlineId: studio.currentOutline.id, versionId, name, isCurrent });
  }
  async function deleteVersion() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const { outlineId, versionId, isCurrent } = deleteTarget;
    studio.deleteVersion(outlineId, versionId);
    if (isCurrent || selectedVersionId === (versionId ?? directContentId(studio.currentOutline.id))) onClearPreview();
    const saved = await studio.saveNow();
    setDeleting(false);
    setDeleteTarget(null);
    onNotice(saved ? "正文已删除" : "删除未完成，请查看保存状态");
  }
  return <><ScrollableDrawer
    scrollMode="content"
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭正文版本" }}
    title={<div className="ws-drawer-title"><span>正文版本</span><span className="ui-title">{outlineDisplayTitle(studio.currentOutline)}</span></div>}
    position={compact ? "bottom" : "right"}
    size={compact ? "calc(100dvh - 10px)" : 920}
    classNames={{ content: "ws-drawer-content version-drawer-shell", header: "ws-drawer-header", body: "ws-drawer-body" }}
    overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
  >
    <div className="version-drawer" aria-label="正文版本">
      {compareVersion ? <div className="diff-view" data-ui-overlay-scroll>
        <Button variant="subtle" size="xs" onClick={() => setCompareVersionId(null)}>← 返回版本</Button>
        <h3>与「{currentContentName}」对比</h3>
        <p><del>{currentContent.slice(0, 500) || "（当前正文为空）"}</del></p>
        <p><ins>{compareVersion.content.slice(0, 500) || "（版本正文为空）"}</ins></p>
        <div className="diff-legend"><span><i className="removed" />{currentContentName}</span><span><i className="added" />{compareVersion.name}</span></div>
      </div> : <div className="version-list" data-ui-overlay-scroll>
        <div className="version-drawer-tools">
          <Button leftSection={<Icon name="plus" />} onClick={() => void createBlankContent()}>新建</Button>
          {studio.currentOutline.defaultVersionId && <Button variant="default" onClick={() => { studio.setDefaultVersion(studio.currentOutline.id); onNotice("已取消默认正文"); }}>取消默认正文</Button>}
        </div>
        {showStandaloneCurrent && <article className={`${directPreviewSelected || !selectedVersionId ? "active" : ""} ${!currentVersion ? "current" : ""}`}>
          <button className="version-preview-main" type="button" onClick={onClearPreview}><div><span className="ui-title" title={standaloneContentName}>{standaloneContentName}</span>{(studio.currentOutline.manualExcellent || standaloneExcellentFragments.length > 0) && <i className="excellent-fragment-dot" title={studio.currentOutline.manualExcellent ? "优秀正文" : "含优秀片段，已自动设为优秀"} />}{!currentVersion && <em>当前 · 已直接保存</em>}</div><p>{formatTime(studio.currentOutline.updatedAt)} · {wordCount(standaloneContent)} 字</p><span>正文</span></button>
          {(directPreviewSelected || !selectedVersionId) && <div className="version-content-preview" aria-label="直接保存正文内容">{standaloneContent ? <ExcellentText text={standaloneContent} fragments={standaloneExcellentFragments} /> : "（正文为空）"}</div>}
          <div className="version-actions"><button className="danger-text" type="button" disabled={deleting} onClick={() => requestDeleteVersion(null, standaloneContentName, !currentVersion)}>删除</button></div>
        </article>}
        {versions.map((version) => {
          const isDefault = studio.currentOutline.defaultVersionId === version.id;
          const isCurrent = currentVersion?.id === version.id;
          const isActive = selectedVersionId ? selectedVersionId === version.id : isCurrent;
          const excellentFragments = normalizeExcellentFragments(version.content, version.excellentFragments);
          const isExcellent = version.manualExcellent === true || excellentFragments.length > 0;
          return <article className={`${isDefault ? "default" : ""} ${isCurrent ? "current" : ""} ${isActive ? "active" : ""}`} key={version.id}>
            <button className="version-preview-main" type="button" onClick={() => isCurrent ? onClearPreview() : onPreview(version.id)}><div><span className="ui-title">{version.name}</span>{isExcellent && <i className="excellent-fragment-dot" title={version.manualExcellent ? "优秀正文" : "含优秀片段，已自动设为优秀"} />}{isCurrent && <em>当前</em>}{isDefault && <em>默认</em>}</div><p>{formatTime(version.createdAt)} · {wordCount(version.content)} 字</p><span>{version.source === "AI Chat" ? "聊天" : version.source === "AI Generate" ? "生成" : version.source}</span></button>
            {version.rewriteSourceId && <button className="version-rewrite-source" type="button" onClick={() => onOpenRewriteSource(version.rewriteSourceId!)}>改写自：{version.rewriteSourceName || "原正文"}</button>}
            {isActive && <div className="version-content-preview" aria-label={`${version.name}正文内容`}>{version.content ? <ExcellentText text={version.content} fragments={excellentFragments} /> : "（正文为空）"}</div>}
            {isActive && version.settingSnapshot && <VersionSettingSnapshotView snapshot={version.settingSnapshot} />}
            <div className="version-actions">
              <button type="button" onClick={() => setCompareVersionId(version.id)}>对比</button>
              <button type="button" disabled={isCurrent} onClick={() => { studio.setCurrentVersion(studio.currentOutline.id, version.id); onClearPreview(); onNotice("已设为当前正文"); }}>{isCurrent ? "已当前" : "设为当前"}</button>
              <button type="button" disabled={isDefault} onClick={() => { studio.setDefaultVersion(studio.currentOutline.id, version.id); onNotice("已设为默认正文"); }}>{isDefault ? "已默认" : "设为默认"}</button>
              <button type="button" onClick={() => void saveVersionAs(version)}>另存</button>
              <button type="button" onClick={() => { const name = window.prompt("重命名版本", version.name); if (name?.trim()) studio.renameVersion(studio.currentOutline.id, version.id, name.trim()); }}>重命名</button>
              <button className="danger-text" type="button" disabled={deleting} onClick={() => requestDeleteVersion(version.id, version.name, isCurrent)}>删除</button>
            </div>
          </article>;
        })}
        {!versions.length && <div className="empty-inline">尚未保存正文版本</div>}
      </div>}
    </div>
  </ScrollableDrawer><BodyDeleteDialog target={deleteTarget} deleting={deleting} onClose={() => { if (!deleting) setDeleteTarget(null); }} onConfirm={() => void deleteVersion()} /></>;
}
