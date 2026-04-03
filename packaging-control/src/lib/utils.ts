import { BusinessUnit, ItemType, MaterialType } from "@prisma/client";

export function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function slugify(value: unknown) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function stringOrNull(value: unknown) {
  const parsed = String(value ?? "").trim();
  return parsed.length ? parsed : null;
}

export function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(String(value).replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

export function dateOrNull(value: unknown) {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function booleanOrNull(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  if (["true", "si", "yes", "1", "y", "packaging"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "0", "n", "non-packaging"].includes(normalized)) {
    return false;
  }

  return null;
}

export function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function createBatchId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function inferBusinessUnit(value: unknown): BusinessUnit | null {
  const normalized = normalizeText(value);

  if (["pharma", "farmaceutico", "farmacia", "medical", "medico"].includes(normalized)) {
    return BusinessUnit.PHARMA;
  }

  if (["cosmetic", "cosmetico", "cosmetica", "beauty"].includes(normalized)) {
    return BusinessUnit.COSMETIC;
  }

  return null;
}

export function inferItemType(value: unknown): ItemType {
  const normalized = normalizeText(value);

  if (normalized.includes("box") || normalized.includes("estuche")) return ItemType.BOX;
  if (normalized.includes("label") || normalized.includes("etiqueta")) return ItemType.LABEL;
  if (normalized.includes("bottle") || normalized.includes("frasco")) return ItemType.BOTTLE;
  if (normalized.includes("leaflet") || normalized.includes("prospecto")) return ItemType.LEAFLET;
  if (normalized.includes("insert")) return ItemType.INSERT;
  if (normalized.includes("tube") || normalized.includes("tubo")) return ItemType.TUBE;
  if (normalized.includes("cap") || normalized.includes("tapa")) return ItemType.CAP;
  if (normalized.includes("sachet") || normalized.includes("sobre")) return ItemType.SACHET;

  return ItemType.OTHER;
}

export function inferMaterialType(value: unknown): MaterialType {
  const normalized = normalizeText(value);

  if (normalized.includes("primary") || normalized.includes("primario") || normalized.includes("frasco")) {
    return MaterialType.PRIMARY_PACKAGING;
  }

  if (normalized.includes("secondary") || normalized.includes("secundario") || normalized.includes("estuche")) {
    return MaterialType.SECONDARY_PACKAGING;
  }

  if (normalized.includes("leaflet") || normalized.includes("prospecto")) {
    return MaterialType.LEAFLET;
  }

  if (normalized.includes("label") || normalized.includes("etiqueta")) {
    return MaterialType.LABEL;
  }

  if (normalized.includes("component") || normalized.includes("componente")) {
    return MaterialType.COMPONENT;
  }

  return MaterialType.OTHER;
}

export function compact<T>(values: Array<T | null | undefined | false>) {
  return values.filter(Boolean) as T[];
}
