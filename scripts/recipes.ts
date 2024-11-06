import puppeteer, { Page } from "puppeteer";
import fs from "fs";
import chalk from "chalk";

import { CraftingRecipe, Item } from "../types";
import itemsJSON from "../data/items.json";
import { sortByKey } from "../utils";
import { error } from "console";

(async () => {
  const woodTypes: string[] = [
    "Oak Planks",
    "Spruce Planks",
    "Birch Planks",
    "Jungle Planks",
    "Acacia Planks",
    "Dark Oak Planks",
    "Crimson Planks",
    "Warped Planks",
  ];

  const colors: string[] = [
    "White",
    "Orange",
    "Magenta",
    "Light Blue",
    "Yellow",
    "Lime",
    "Pink",
    "Gray",
    "Light Gray",
    "Cyan",
    "Purple",
    "Blue",
    "Brown",
    "Green",
    "Red",
    "Black",
  ];

  const materials: { name: string; item: string | string[] }[] = [
    { name: "Wooden", item: woodTypes },
    { name: "Stone", item: "Cobblestone" },
    { name: "Iron", item: "Iron Ingot" },
    { name: "Golden", item: "Gold Ingot" },
    { name: "Diamond", item: "Diamond" },
  ];

  const effects: string[] = [
    "Splashing",
    "Regeneration",
    "Swiftness",
    "Fire Resistance",
    "Poison",
    "Healing",
    "Night Vision",
    "Weakness",
    "Strength",
    "Slowness",
    "Leaping",
    "Harming",
    "Water Breathing",
    "Invisibility",
    "Luck",
    "the Turtle Master",
    "Slow Falling",
  ];

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  await loadCraftingPage(page);
  const recipes = await scrapeCraftingRecipes(page);

  await browser.close();

  addColoredBedRecipes(recipes, colors, woodTypes);
  addShulkerBoxRecipes(recipes, colors);
  addToolRecipes(recipes, materials);
  addFireworkRecipes(recipes, colors);
  addTippedArrowRecipes(recipes, effects);
  addWrittenBookRecipes(recipes);

  // const [validRecipes, invalidItems] = filterInvalidItems(recipes, itemsJSON);

  // console.log("Writing recipes to file...", validRecipes.length);
  sortByKey(recipes, "item");
  writeRecipesToFile(recipes, "./data/recipes.json");

  // console.log(invalidItems);
  console.log(chalk.blue("Done writing recipes. The items that were left out are above."));
})();

async function loadCraftingPage(page: Page) {
  console.log("Opening crafting page...");
  await page.goto("https://minecraft.wiki/w/Crafting", {
    waitUntil: "networkidle2",
  });
  console.log("Crafting page loaded");

  console.log("Loading crafting recipes");
  await page.evaluate(() => {
    document
      .querySelectorAll(".load-page[data-page] .jslink")
      .forEach((button) => (button as HTMLElement).click());
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".load-page[data-page] table").length === 11,
    { timeout: 50000 }
  );
  console.log("Crafting recipes loaded");
}

async function scrapeCraftingRecipes(page: Page): Promise<CraftingRecipe[]> {
  return await page.evaluate(() => {
    let boatIndex = 0;
    const rows = Array.from(
      document.querySelectorAll<HTMLTableRowElement>(".load-page[data-page] table tbody tr")
    );

    let notarow = 0;

    const filterRows = (row: HTMLTableRowElement) => {
      if (!row || !("querySelector" in row)) {
        notarow++;
        return false;
      }
      const details = row.querySelector("td:nth-child(4)");
      const excludeDetails = [
        "Bedrock Edition",
        "Minecraft Education",
        "Minecraft Earth",
        "upcoming",
        "Calcium",
      ];
      const excludeKeywords = [
        "Glow Stick",
        "Any Planks +",
        "Firework Star",
        "Firework Rocket",
        "Tipped Arrow",
        "Written Book",
        "Resin",
      ];

      if (
        !details ||
        excludeDetails.some((detail) => details.textContent?.includes(detail)) ||
        excludeKeywords.some((keyword) => row.textContent.includes(keyword)) ||
        row.textContent.includes("Any Planks or") ||
        row.querySelector('a[title="Planks"]') ||
        excludeKeywords.includes(row.querySelector("a[title]").getAttribute("title")) ||
        row.querySelectorAll(".invslot-large .invslot-item span").length === 0
      ) {
        return false;
      }
      return true;
    };

    const processRow = (row: HTMLTableRowElement) => {
      const recipes: {
        item: string;
        quantity: number;
        recipe: (string | string[] | null)[];
        shapeless: boolean;
      }[] = [];

      const recipeNames = Array.from(row.querySelectorAll(".mcui-output .invslot-item"));
      //first, get the output items
      const recipeNamesWithIndex = recipeNames.map((elem, index) => {
        const name =
          elem.hasAttribute("data-minetip-title") &&
          !elem.getAttribute("data-minetip-title").startsWith("&")
            ? elem.getAttribute("data-minetip-title")
            : elem.querySelector("a").getAttribute("title");
        return {
          name: name,
          index: index,
          totalLength: recipeNames.length,
        };
      });

      recipeNamesWithIndex.forEach((recipeNameWithIndex) => {
        const recipe: Partial<CraftingRecipe> = {
          item: recipeNameWithIndex.name,
        };

        //get the recipe
        const nineTiles = Array.from(row.querySelectorAll(".mcui-input .invslot"));
        if (nineTiles.length !== 9) throw new Error("Recipe does not have 9 tiles");

        const recipeTiles = nineTiles.map((tile, index) => {
          const variants = Array.from(tile.querySelectorAll(".invslot-item"));

          if (variants.length === 0) {
            return null;
          }
          if (variants.length === 1) {
            return variants[0].querySelector("a").getAttribute("title");
          }
          if (variants.length === recipeNameWithIndex.totalLength) {
            const variant = variants[recipeNameWithIndex.index];
            if (!variant.hasChildNodes()) return null;

            if (variant.hasAttribute("data-minetip-title")) {
              return variant.getAttribute("data-minetip-title");
            }

            if (variant.querySelector("a")) {
              return variant.querySelector("a").getAttribute("title");
            }

            throw new Error(
              "No title found for variant index:" +
                variant.hasChildNodes() +
                ", " +
                recipeNameWithIndex.name
            );
          }

          const titles = variants.map((variant) => {
            if (variant.hasAttribute("data-minetip-title")) {
              return variant.getAttribute("data-minetip-title");
            }
            return variant.querySelector("a").getAttribute("title");
          });

          return titles;
        });

        recipe.recipe = recipeTiles;
        if (recipeNameWithIndex.name === "Acacia Boat") {
          boatIndex++;
          // throw new Error(JSON.stringify(recipe));
        }
        recipes.push(recipe as CraftingRecipe);
      });

      if (recipeNamesWithIndex.find((recipe) => recipe.name === "Acacia Boat")) {
      }

      return recipes;
    };

    const recipes = rows.filter(filterRows).map(processRow).flat();

    const newRecipes = recipes.filter(Boolean);

    return newRecipes;
  });
}

function addColoredBedRecipes(recipes: CraftingRecipe[], colors: string[], woodTypes: string[]) {
  colors.forEach((color) => {
    recipes.push({
      item: `${color} Bed`,
      quantity: 1,
      recipe: [
        null,
        null,
        null,
        `${color} Wool`,
        `${color} Wool`,
        `${color} Wool`,
        woodTypes,
        woodTypes,
        woodTypes,
      ],
      shapeless: false,
    });
  });
}

function addShulkerBoxRecipes(recipes: CraftingRecipe[], colors: string[]) {
  colors.forEach((color) => {
    recipes.push({
      item: `${color} Shulker Box`,
      quantity: 1,
      recipe: [
        null,
        null,
        null,
        colors.map((c) => `${c} Shulker Box`),
        `${color} Dye`,
        null,
        null,
        null,
        null,
      ],
      shapeless: true,
    });
  });
}

function addToolRecipes(
  recipes: CraftingRecipe[],
  materials: { name: string; item: string | string[] }[]
) {
  materials.forEach((material) => {
    const tools = [
      {
        name: "Pickaxe",
        recipe: [
          material.item,
          material.item,
          material.item,
          null,
          "Stick",
          null,
          null,
          "Stick",
          null,
        ],
      },
      {
        name: "Sword",
        recipe: [null, material.item, null, null, material.item, null, null, "Stick", null],
      },
      {
        name: "Axe",
        recipe: [
          material.item,
          material.item,
          null,
          material.item,
          "Stick",
          null,
          null,
          "Stick",
          null,
        ],
      },
      {
        name: "Shovel",
        recipe: [null, material.item, null, null, "Stick", null, null, "Stick", null],
      },
      {
        name: "Hoe",
        recipe: [material.item, material.item, null, null, "Stick", null, null, "Stick", null],
      },
    ];

    tools.forEach((tool) => {
      recipes.push({
        item: `${material.name} ${tool.name}`,
        quantity: 1,
        recipe: tool.recipe,
        shapeless: false,
      });
    });
  });
}

function addFireworkRecipes(recipes: CraftingRecipe[], colors: string[]) {
  const dyes = colors.map((color) => `${color} Dye`);

  recipes.push({
    item: "Firework Star",
    quantity: 1,
    recipe: [
      "Gunpowder",
      dyes,
      [
        null,
        ...dyes,
        "Skeleton Skull",
        "Wither Skeleton Skull",
        "Zombie Head",
        "Player Head",
        "Creeper Head",
        "Dragon Head",
        "Gold Nugget",
        "Feather",
        "Fire Charge",
      ],
      [null, ...dyes, "Glowstone"],
      [null, ...dyes, "Diamond"],
      [null, ...dyes],
      [null, ...dyes],
      [null, ...dyes],
      [null, ...dyes],
    ],
    shapeless: true,
  });

  recipes.push({
    item: "Firework Star",
    quantity: 1,
    recipe: [null, null, null, "Firework Star", dyes, null, null, null, null],
    shapeless: true,
  });

  recipes.push({
    item: "Firework Rocket",
    quantity: 3,
    recipe: [
      null,
      null,
      null,
      "Paper",
      "Gunpowder",
      [null, "Gunpowder"],
      [null, "Gunpowder"],
      null,
      null,
    ],
    shapeless: true,
  });

  recipes.push({
    item: "Firework Rocket",
    quantity: 3,
    recipe: [
      null,
      null,
      null,
      "Firework Star",
      "Paper",
      "Gunpowder",
      [null, "Gunpowder"],
      [null, "Gunpowder"],
      null,
    ],
    shapeless: true,
  });
}

function addTippedArrowRecipes(recipes: CraftingRecipe[], effects: string[]) {
  effects.forEach((effect) => {
    const potion =
      effect === "Splashing" ? "Lingering Water Bottle" : `Lingering Potion of ${effect}`;

    recipes.push({
      item: `Arrow of ${effect}`,
      quantity: 8,
      recipe: ["Arrow", "Arrow", "Arrow", "Arrow", potion, "Arrow", "Arrow", "Arrow", "Arrow"],
      shapeless: false,
    });
  });
}

function addWrittenBookRecipes(recipes: CraftingRecipe[]) {
  for (let i = 1; i <= 8; i++) {
    recipes.push({
      item: "Written Book",
      quantity: i,
      recipe: ["Written Book", ...Array(i).fill("Book and Quill"), ...Array(8 - i).fill(null)],
      shapeless: true,
    });
  }
}

function writeRecipesToFile(recipes: CraftingRecipe[], filename: string) {
  fs.writeFileSync(filename, JSON.stringify(recipes, null, 2));
}
