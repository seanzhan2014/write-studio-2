"use client";
import { Text } from "@mantine/core";
import { useState } from "react";

import { characterPhotos, type CharacterPhotoGallery } from "@/lib/character-photos";
import { characterCover, characterImageSrc, type CharacterVisual } from "@/lib/character-visual";

export function CharacterAvatar({ visual, photos, name }: { visual?: CharacterVisual; photos?: CharacterPhotoGallery; name: string }) {
  const [failedSrc, setFailedSrc] = useState("");
  const gallery = characterPhotos(photos, visual);
  const cover = gallery.photos.find(p => p.id === gallery.coverId) || (!photos ? characterCover(visual) : undefined);
  const src = cover ? characterImageSrc(cover) : "";
  return src && failedSrc !== src ? <img src={src} alt={`${name}的角色主图`} className="character-cover-image" loading="lazy" onError={() => setFailedSrc(src)} /> : <>{name[0]}</>;
}

export function CharacterReferenceSummary({ reference }: { reference?: import("@/lib/character-visual").CharacterReference }) {
  if (!reference) return null;
  const images = reference.photos || reference.visual?.images || [];
  return <div className="character-reference-summary"><Text size="sm" fw={500}>人物快照：{reference.name} · {reference.visual?.characterName || "人物照片"} · {images.length} 张参考图</Text><div className="character-reference-thumbnails">{images.map((image, index) => <a key={image.id} href={characterImageSrc(image)} target="_blank" rel="noreferrer"><img src={characterImageSrc(image)} alt={`${reference.name}的生成参考图 ${index + 1}`} loading="lazy" /></a>)}</div>{reference.appearance && <Text size="xs" c="dimmed">当时外貌：{reference.appearance}</Text>}</div>;
}
