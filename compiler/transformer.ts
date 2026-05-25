import { RawRule } from "./parser";

const RESOURCE_TYPE_MAP: Record<string, string> = {
  script: "script",
  image: "image",
  stylesheet: "stylesheet",
  object: "object",
  xmlhttprequest: "xmlhttprequest",
  subdocument: "sub_frame",
  font: "font",
  media: "media",
  websocket: "websocket",
};

const DEFAULT_RESOURCE_TYPES = [
  "script", "image", "stylesheet",
  "xmlhttprequest", "sub_frame", "font", "media"
];

export type DNRRule = {
  id: number;
  priority: number;
  action: { type: "block" | "allow" };
  condition: {
    urlFilter: string;
    resourceTypes?: string[];
    isUrlFilterCaseSensitive: boolean;
  };
};

export function transformRule(raw: RawRule, id: number): DNRRule | null {
  // Skip obviously bad domains
  if (raw.domain.length < 4 || raw.domain.includes(" ")) return null;

  // Map options to DNR resource types
  const mappedTypes = raw.options
    .map(o => RESOURCE_TYPE_MAP[o.replace("~", "")])
    .filter(Boolean);

  const resourceTypes = mappedTypes.length ? mappedTypes : DEFAULT_RESOURCE_TYPES;

  return {
    id,
    priority: raw.isException ? 2 : 1,  // exceptions win
    action: { type: raw.isException ? "allow" : "block" },
    condition: {
      urlFilter: `||${raw.domain}^`,
      resourceTypes,
      isUrlFilterCaseSensitive: false,
    },
  };
}