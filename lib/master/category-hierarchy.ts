/**
 * Category hierarchy helpers — pure TypeScript (no Supabase / no "use server").
 */

export type CategoryFlatRow = {
  id: string;
  category_code: string;
  category_name: string;
  parent_id: string | null;
  is_active?: boolean | null;
};

export type CategoryWithParent = {
  id: string;
  category_code: string;
  category_name: string;
  parent_id?: string | null;
  parent_category_code?: string | null;
  parent_category_name?: string | null;
};

export type CategoryHierarchyGroup = {
  /** Root category (parent_id IS NULL) — group header, not selectable */
  parent: CategoryWithParent;
  /** Child categories mapped under this root */
  children: CategoryWithParent[];
};

/** Enrich child rows with parent name/code from a flat active category list. */
export function enrichCategoriesFromFlatList(
  rows: CategoryFlatRow[],
): CategoryWithParent[] {
  const byId = new Map(rows.map((row) => [row.id, row]));

  return rows.map((row) => {
    const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
    return {
      id: row.id,
      category_code: row.category_code,
      category_name: row.category_name,
      parent_id: row.parent_id,
      parent_category_code: parent?.category_code ?? null,
      parent_category_name: parent?.category_name ?? null,
    };
  });
}

/**
 * Parent → Child grouping in application code (ERP Master Data pattern).
 * Roots with no children are omitted from picker groups.
 */
export function groupCategoriesHierarchy(
  categories: CategoryWithParent[],
): CategoryHierarchyGroup[] {
  const roots = categories.filter((row) => !row.parent_id);
  const children = categories.filter((row) => row.parent_id);

  return roots
    .map((parent) => ({
      parent,
      children: children
        .filter((child) => child.parent_id === parent.id)
        .sort((left, right) =>
          left.category_code
            .trim()
            .toUpperCase()
            .localeCompare(right.category_code.trim().toUpperCase(), "en"),
        ),
    }))
    .filter((group) => group.children.length > 0)
    .sort((left, right) =>
      left.parent.category_code
        .trim()
        .toUpperCase()
        .localeCompare(right.parent.category_code.trim().toUpperCase(), "en"),
    );
}

export function enrichSingleCategoryRow(
  row: CategoryFlatRow,
  parent?: Pick<CategoryFlatRow, "category_code" | "category_name"> | null,
): CategoryWithParent {
  return {
    id: row.id,
    category_code: row.category_code,
    category_name: row.category_name,
    parent_id: row.parent_id,
    parent_category_code: parent?.category_code ?? null,
    parent_category_name: parent?.category_name ?? null,
  };
}
