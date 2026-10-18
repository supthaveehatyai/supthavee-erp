export type GeminiModelOption = {
  id: string;
  displayName: string;
};

export type ListGeminiModelsResult =
  | { success: true; models: GeminiModelOption[] }
  | { success: false; error: string };
