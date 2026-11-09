import type { SalesBundleComponentLine } from "@/types/document";

export function BundleLineDetails({
  description,
  components,
}: {
  description: string;
  components?: SalesBundleComponentLine[];
}) {
  return (
    <div>
      <span className="line-clamp-2">{description}</span>
      {components && components.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
          {components.map((component) => (
            <li key={`${component.product_id}-${component.sku}`}>
              {component.description.startsWith("↳")
                ? component.description
                : `↳ ${component.description}`}{" "}
              × {component.qty}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
