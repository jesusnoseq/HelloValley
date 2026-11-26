import { getRecipe, groupItems, recipeCard, RECIPE_CARD_LABEL_KEYS, type RecipeId } from "@hellovalley/shared";
import type { ReactNode } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { LabelChip } from "../labels/LabelChip";
import { itemIcon } from "../items/items";

export interface RecipeCardProps {
  recipeId: RecipeId;
  /** The target language the card is written in. */
  lang: string;
  /** How many of each item the player holds (shows have/need per line), or omitted. */
  counts?: Readonly<Partial<Record<string, number>>>;
  /** Extra lines under the card (teacher, dishes cooked). */
  footer?: ReactNode;
  /** The Cook button (kitchen only). */
  action?: ReactNode;
}

/**
 * A recipe card (GDD §5.4: "recipe cards are written in the target language", build plan M29):
 * the dish, the ingredients with their amounts and the method, every word a world label in the
 * target language (shared food/recipeCard.ts). Each word is a LabelChip, so a click plays it and
 * saves it to the notebook. Shown in the kitchen and when an NPC teaches the recipe.
 */
export function RecipeCard({ recipeId, lang, counts, footer, action }: RecipeCardProps) {
  const { t } = useI18n();
  const card = recipeCard(recipeId);
  const recipe = getRecipe(recipeId)!;
  return (
    <article className="hv-recipe" aria-label={recipeId}>
      <header className="hv-recipe__title">
        <span aria-hidden="true">{itemIcon(recipe.result)}</span> <LabelChip lang={lang} labelKey={card.titleKey} />
        <span className="hv-recipe__kind">
          <LabelChip lang={lang} labelKey={RECIPE_CARD_LABEL_KEYS.recipe} />
        </span>
      </header>
      <h4 className="hv-recipe__heading">
        <LabelChip lang={lang} labelKey={RECIPE_CARD_LABEL_KEYS.ingredients} />
      </h4>
      <ul className="hv-recipe__lines">
        {card.lines.map((line, i) => {
          const ingredient = recipe.ingredients[i]!;
          const have = counts ? ("item" in ingredient ? (counts[ingredient.item] ?? 0) : Math.max(0, ...groupItems(ingredient.anyOf).map((id) => counts[id] ?? 0))) : null;
          const enough = have === null || have >= line.qty;
          return (
            <li key={line.labelKey} className={enough ? undefined : "hv-recipe__line--missing"}>
              <span className="hv-recipe__qty">{line.qty} ×</span> <LabelChip lang={lang} labelKey={line.labelKey} />
              {have !== null ? (
                <span className="hv-recipe__have" aria-label={t("food.kitchen.have", { have: String(have), need: String(line.qty) })}>
                  {enough ? " ✓" : ` ${have}/${line.qty}`}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <h4 className="hv-recipe__heading">
        <LabelChip lang={lang} labelKey={RECIPE_CARD_LABEL_KEYS.method} />
      </h4>
      <ol className="hv-recipe__steps">
        {card.steps.map((key) => (
          <li key={key}>
            <LabelChip lang={lang} labelKey={key} />
          </li>
        ))}
      </ol>
      {footer}
      {action}
    </article>
  );
}
