import puppeteer, { Browser, ElementHandle, Page } from "puppeteer";
import fs from "fs";
import pLimit from "p-limit";
import sharp from "sharp";
import chalk from "chalk";

import { Item } from "../types";
import itemsJSON from "../data/items.json";
import { sortByKey } from "../utils";
import axios from "axios";

// Constants
const ITEMS_JSON_PATH = "data/items.json";
const ITEMS_IMAGE_PATH = "../public/items/";
const DATA_VALUES_URL = "https://minecraft.wiki/w/Java_Edition_data_values";
const EXCLUDED_ITEMS = [
  "Lingering Potion",
  "Potion",
  "Splash Potion",
  "Tipped Arrow",
  "Music Disc",
  "Chorus Plant",
  "Ominous Shield",
];

// Initialize items and names arrays
let items: Item[] = itemsJSON;
let names: string[] = items.map((item) => item.name);

// Limit concurrent operations
const limit = pLimit(3);

/**
 * Writes the items array to a JSON file after sorting.
 */
function writeItems(items: Item[]): void {
  sortByKey(items, "name");
  fs.writeFileSync(ITEMS_JSON_PATH, JSON.stringify(items, null, 2));
}

/**
 * Launches the Puppeteer browser.
 */
async function initBrowser(): Promise<Browser> {
  return puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });
}

/**
 * Opens the data page and loads item and block tables.
 */
async function openDataPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  console.log("Opening data page...");
  await page.goto(DATA_VALUES_URL, { timeout: 0 });

  // Expand item and block sections
  await page.waitForSelector("div[data-page='Java Edition data values/Items'] .jslink");
  await page.click("div[data-page='Java Edition data values/Items'] .jslink");
  await page.waitForSelector("a[title='Spawn Egg']");

  await page.waitForSelector("div[data-page='Java Edition data values/Blocks'] .jslink");
  await page.click("div[data-page='Java Edition data values/Blocks'] .jslink");
  await page.waitForSelector("a[href='/w/File:Acacia_Leaves.png']");
  return page;
}

async function populateItemsJson(
  dataPage: Page,
  row: ElementHandle<Element>,
  name: string,
  browser: Browser
) {
  try {
    const namespacedId: string = await getNamespacedId(dataPage, row);
    const url: string = await getItemPageUrl(dataPage, row, name);
    const itemData: Item | null = await getItemDetails(browser, url, name, namespacedId);

    if (itemData) {
      items.push(itemData);
      writeItems(items);
      console.log(`Successfully added item: ${name}`);
    }
  } catch (error) {
    console.error(chalk.red(`Error processing item: ${name}`), error);
  }
}

/**
 * Processes regular items from the data page.
 */
async function processRegularItems(browser: Browser, dataPage: Page): Promise<void> {
  // Select all item rows
  const itemRows: ElementHandle<Element>[] = await dataPage.$$(
    "div[data-page='Java Edition data values/Items'] .stikitable tbody tr, " +
      "div[data-page='Java Edition data values/Blocks'] .stikitable tbody tr"
  );

  // Process each item row
  await Promise.all(
    itemRows.map((row) =>
      limit(async () => {
        let name: string = await getItemName(dataPage, row);
        if (!shouldProcessItem(name)) return;
        await populateItemsJson(dataPage, row, name, browser);
      })
    )
  );
  console.log(chalk.blue("Finished processing regular items"));
}

/**
 * Checks if an item should be processed.
 */
function shouldProcessItem(name: string): boolean {
  return name && !names.includes(name) && !EXCLUDED_ITEMS.includes(name);
}

/**
 * Retrieves the item name from a row element.
 */
async function getItemName(page: Page, row: ElementHandle<Element>): Promise<string> {
  let name: string = await page.evaluate((element) => {
    const isStyled = element.querySelector("td:last-child[style]");
    if (isStyled) return "";
    return element.querySelector("a")!.innerText.trim();
  }, row);

  // Handle special cases
  if (name.startsWith("Banner Pattern")) {
    const text: string = await page.evaluate((element) => {
      const td = element.querySelector("td");
      const bannerName = td?.innerText.split(" (")[1].replace(")", "");
      return td ? `${bannerName} Banner Pattern` : "";
    }, row);
    name = text;
  } else if (name === "Pufferfish (item)") {
    name = "Pufferfish";
  } else if (name === "Light Block") {
    name = "Light";
  }

  return name;
}

/**
 * Retrieves the namespaced ID from a row element.
 */
async function getNamespacedId(page: Page, row: ElementHandle<Element>): Promise<string> {
  const codeElement = await row.$("code");
  if (codeElement) {
    const textContent = await page.evaluate((element) => element.textContent, codeElement);
    return textContent ? textContent.trim() : "";
  }
  return "";
}

/**
 * Retrieves the item page URL.
 */
async function getItemPageUrl(
  page: Page,
  row: ElementHandle<Element>,
  name: string
): Promise<string> {
  if (name === "Tropical Fish") {
    return "https://minecraft.wiki/w/Tropical_Fish";
  } else {
    const hrefHandle = await (await row.$("a")).evaluate((element) => element.getAttribute("href"));
    return `https://minecraft.wiki${hrefHandle}`;
  }
}

async function downloadImagePNG(url: string, namespaceId: string): Promise<void> {
  // Fetch the image using Axios
  const response = await axios.get(url, { responseType: "arraybuffer" });

  if (response.status !== 200) {
    throw new Error(`Failed to fetch image. Status code: ${response.status}`);
  }

  const imageBuffer = Buffer.from(response.data, "binary");

  // Process the image with Sharp
  const resizedImageBuffer = await sharp(imageBuffer)
    .resize(32, 32, {
      fit: "inside",
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();

  // Ensure the directory exists
  const outputPath = `public/items/${namespaceId}.png`;
  await fs.promises.mkdir("public/items", { recursive: true });

  // Write the resized image
  await fs.promises.writeFile(outputPath, resizedImageBuffer);
  console.log(`Image saved to ${outputPath}`);
}

/**
 * Downloads a GIF image from the specified URL and saves it to the designated path.
 *
 * @param url - The URL of the GIF image to download.
 * @param outputPath - The file path where the GIF should be saved.
 */
async function downloadGifImage(url: string, outputPath: string): Promise<void> {
  try {
    // Fetch the GIF image using Axios with responseType 'arraybuffer'
    const response = await axios.get(url, { responseType: "arraybuffer" });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch GIF image. Status code: ${response.status}`);
    }

    const imageBuffer = Buffer.from(response.data, "binary");

    // Ensure the directory exists
    const directory = outputPath.substring(0, outputPath.lastIndexOf("/"));
    await fs.promises.mkdir(directory, { recursive: true });

    // Write the GIF image to the specified path
    await fs.promises.writeFile(outputPath, imageBuffer);
    console.log(`GIF image saved to ${outputPath}`);
  } catch (error) {
    console.error(chalk.red(`Error downloading GIF image from ${url}`), error);
    throw error; // Re-throw the error to handle it upstream if necessary
  }
}

/**
 * Retrieves detailed information about an item.
 */
async function getItemDetails(
  browser: Browser,
  url: string,
  name: string,
  namespacedId: string
): Promise<Item | null> {
  const itemPage: Page = await browser.newPage();
  try {
    await itemPage.goto(url.trim(), { timeout: 0, waitUntil: "networkidle2" });
    await itemPage.waitForSelector(".invslot-item");
    const imageName: string = name.startsWith("Banner Pattern") ? "banner_pattern" : namespacedId;
    let image: string = `https://mc.geertvandrunen.nl/_new/items/${imageName}.png`;

    const imageUrl = await getImageUrl(itemPage, namespacedId, name);

    if (imageUrl) {
      console.log("Processing image from URL:", imageUrl);
      await downloadImagePNG(imageUrl, namespacedId);

      // Update the image URL to point to the local image
      image = `https://mc.geertvandrunen.nl/_new/items/${namespacedId}.png`;
    } else {
      console.log("Image URL not found. Handling GIF images.");
      // Handle GIF images
      const gifURL: string | null = await getGifURL(itemPage, name);
      if (gifURL) {
        await downloadGifImage(gifURL, `${ITEMS_IMAGE_PATH}${imageName}.gif`);
        image = image.replace("png", "gif");
      } else {
        throw new Error("Image details and GIF URL not found.");
      }
    }

    const stackSize: number | null = await getStackSize(itemPage, name);
    if (stackSize === null) {
      console.error(chalk.red(`Error getting stack size for item: ${name}`));
      return null;
    }

    const renewable: boolean | null = await getRenewableStatus(itemPage, name);
    if (renewable === null) {
      console.error(chalk.red(`Error getting renewable status for item: ${name}`));
      return null;
    }

    const description: string = await getDescription(itemPage);

    return {
      name,
      namespacedId,
      description,
      image,
      renewable,
      stackSize,
    };
  } catch (error) {
    console.error(chalk.red(`Error processing item page for item: ${name}`), error);
    return null;
  } finally {
    await itemPage.close();
  }
}

/**
 * Retrieves image details from the item page.
 */
async function getImageUrl(page: Page, namespaceId: string, name: string): Promise<string | null> {
  try {
    return await page.evaluate((name: string) => {
      const invImages = Array.from(
        document.querySelectorAll(`.infobox-imagearea .invslot-item-image img`)
      );
      let foundImage;

      if (invImages.length === 1) {
        foundImage = invImages[0];
      } else {
        foundImage = invImages.find((img) => {
          return (img as HTMLImageElement).alt.toLowerCase().includes(name.toLowerCase());
        });
      }

      if (!foundImage && name.startsWith("Banner Pattern")) {
        //Banner Pattern (Creeper Charge) -> Creeper Charge
        const variant = name.replace("Banner Pattern (", "").replace(")", "");
        foundImage = invImages.find((img) => {
          return (img as HTMLImageElement).alt.toLowerCase().includes(variant.toLowerCase());
        });
      }

      if (!foundImage && name.startsWith("Smithing Template")) {
        const variant = name.replace("Smithing Template (", "").replace(")", "");
        foundImage = invImages.find((img) => {
          return (img as HTMLImageElement).alt.toLowerCase().includes(variant.toLowerCase());
        });
      }

      if (!foundImage && name.startsWith("Music Disc")) {
        const variant = name.replace("Music Disc (", "").replace(")", "");
        foundImage = invImages.find((img) => {
          return (img as HTMLImageElement).alt.toLowerCase().includes(variant.toLowerCase());
        });
      }

      if (!foundImage && name.includes("Music Box version")) {
        const variant = "Creator";
        foundImage = invImages.find((img) => {
          return (img as HTMLImageElement).alt.toLowerCase().includes(variant.toLowerCase());
        });
      }

      if (!foundImage && name.includes("Boat with Chest")) {
        const variant = name.split(" ")[0];
        foundImage = invImages.find((img) => {
          return (img as HTMLImageElement).alt.toLowerCase().includes(variant.toLowerCase());
        });
      }

      if (foundImage) {
        return `https://minecraft.wiki${foundImage.getAttribute("src")}`;
      }

      return null;
    }, name);
  } catch {
    chalk.bgBlue(`Error getting image details for item: ${namespaceId} - ${name}`);
    return null;
  }
}

/**
 * Retrieves the GIF URL from the item page.
 */
async function getGifURL(page: Page, name: string): Promise<string | null> {
  return page.evaluate((itemName: string) => {
    const img = Array.from(document.querySelectorAll(".invslot-item img")).find(
      (img) => (img as HTMLImageElement).alt === itemName
    ) as HTMLImageElement | undefined;
    return img ? img.getAttribute("data-src") || img.src : null;
  }, name);
}

/**
 * Retrieves the stack size from the item page.
 */
async function getStackSize(page: Page, name: string): Promise<number | null> {
  const exceptions = ["Pufferfish"];

  if (exceptions.includes(name)) return 1;

  return await page.evaluate(() => {
    // Find the row with the "Stackable" header
    const row = Array.from(document.querySelectorAll(".infobox-rows tr")).find((row) =>
      row.querySelector("th")?.textContent.includes("Stackable")
    );

    if (!row) return null;

    // Get the text from the <td>, whether it's inside a <p> or not
    const td = row.querySelector("td");
    const text = td ? td.textContent.trim() : "";

    // Check if the item is not stackable
    if (text === "No" || text.includes("JE: No")) return 1;
    if (text.startsWith("Yes,")) {
      const match = text.match(/\d+/);
      return match ? parseInt(match[0], 10) : 64;
    }
    // Extract the stack size number
    const match = text.match(/\((\d+)\)/);
    if (match) {
      return parseInt(match[1], 10);
    }

    // If the text is a number (e.g., "64"), return it directly
    const number = parseInt(text, 10);
    if (!isNaN(number)) {
      return number;
    }

    // If all else fails, return null
    return null;
  });
}

/**
 * Determines if an item is renewable.
 */
async function getRenewableStatus(page: Page, name: string): Promise<boolean | null> {
  // Handle special cases
  const specialCases = {
    renewable: {
      true: [
        "Arrow",
        "Spectral Arrow",
        "Bundle",
        "Clay",
        "Skeleton Skull",
        "Wither Skeleton Skull",
        "Zombie Head",
        "Creeper Head",
        "Grass",
        "Fern",
        "Leather Cap",
        "Leather Tunic",
        "Leather Pants",
        "Turtle Shell",
        "Firework Star",
        "Firework Rocket",
        "Shulker Shell",
        "Clay Ball",
        "Enchanted Book",
        "Music Disc (13)",
        "Music Disc (Cat)",
        "Music Disc (Blocks)",
        "Music Disc (Chirp)",
        "Music Disc (Far)",
        "Music Disc (Mall)",
        "Music Disc (Mellohi)",
        "Music Disc (Stal)",
        "Music Disc (Strad)",
        "Music Disc (Ward)",
        "Music Disc (11)",
        "Music Disc (Wait)",
      ],
      false: ["Dirt Path", "Dragon Head", "Player Head", "Tall Grass", "Large Fern", "Pufferfish"],
    },
    endsWith: {
      true: ["Shulker Box"],
      false: ["Nylium"],
    },
    contains: {
      false: ["Infested", "Smithing Template", "Music Disc", "Banner Pattern"],
    },
  };

  if (specialCases.renewable.true.includes(name)) return true;
  if (specialCases.renewable.false.includes(name)) return false;

  if (specialCases.endsWith.true.some((ending) => name.endsWith(ending))) return true;
  if (specialCases.endsWith.false.some((ending) => name.endsWith(ending))) return false;

  if (specialCases.contains.false.some((substr) => name.includes(substr))) return false;

  // Check more patterns
  const patterns = [
    {
      condition: (name: string) =>
        ["Slab", "Stairs", "Wall"].some((ending) => name.endsWith(ending)),
      value: (name: string) => !name.includes("Deepslate"),
    },
    {
      condition: (name: string) => name.includes("Banner Pattern"),
      value: (name: string) => !["(Snout)", "(Thing)"].some((pattern) => name.endsWith(pattern)),
    },
    {
      condition: (name: string) =>
        [
          "Pickaxe",
          "Hoe",
          "Axe",
          "Shovel",
          "Sword",
          "Helmet",
          "Chestplate",
          "Leggings",
          "Boots",
        ].some((ending) => name.endsWith(ending)),
      value: (name: string) => !name.startsWith("Netherite"),
    },
    {
      condition: (name: string) => name.endsWith("Horse Armor"),
      value: (name: string) => name.startsWith("Leather"),
    },
    {
      condition: (name: string) => name.endsWith("Terracotta"),
      value: (name: string) => name === "Terracotta",
    },
  ];

  for (const pattern of patterns) {
    if (pattern.condition(name)) {
      return pattern.value(name);
    }
  }

  // Default: Try to extract from the page
  return page.evaluate(() => {
    let row;
    row = Array.from(document.querySelectorAll(".infobox-rows tr")).find((row) =>
      row.textContent?.includes("Renewable")
    );

    if (!row) return null;
    const p = row.querySelector("p");
    const text = p ? p.innerText.trim() : "";
    if (text.startsWith("Yes")) return true;
    if (text.startsWith("No")) return false;
    return null;
  });
}

/**
 * Retrieves the item description from the page.
 */
async function getDescription(page: Page): Promise<string> {
  return page.evaluate(() => {
    const paragraph = document.querySelector(".mw-parser-output > p");
    return paragraph ? paragraph.textContent?.replace(/\[a\]|\n$/g, "").trim() || "" : "";
  });
}

/**
 * Processes special items like Potions and Music Discs.
 */
async function processSpecialItems(browser: Browser): Promise<void> {
  const pages = [
    {
      page: "Tipped_Arrow",
      namespacedId: "tipped_arrow",
      stackSize: 64,
      renewable: (title: string) => !["Uncraftable", "Luck"].some((type) => title.endsWith(type)),
      filter: (title: string) =>
        !["Arrow", "Spectral Arrow"].includes(title) && !title.includes("Decay"),
    },
    {
      page: "Bundle",
      namespacedId: "bundle",
      stackSize: 1,
      renewable: () => true,
      filter: () => true,
    },
    {
      page: "Shield",
      namespacedId: "shield",
      stackSize: 1,
      renewable: () => true,
      filter: () => true,
    },
    {
      page: "Potion",
      namespacedId: "potion",
      stackSize: 1,
      renewable: (title: string) => !["Uncraftable", "Luck"].some((type) => title.endsWith(type)),
      filter: (title: string) => !title.includes("Decay"),
    },
    {
      page: "Splash_Potion",
      namespacedId: "splash_potion",
      stackSize: 1,
      renewable: (title: string) => !["Uncraftable", "Luck"].some((type) => title.endsWith(type)),
      filter: (title: string) => !title.includes("Decay"),
    },
    {
      page: "Lingering_Potion",
      namespacedId: "lingering_potion",
      stackSize: 1,
      renewable: (title: string) => !["Uncraftable", "Luck"].some((type) => title.endsWith(type)),
      filter: (title: string) => !title.includes("Decay"),
    },
    {
      page: "Map",
      namespacedId: "filled_map",
      stackSize: 64,
      renewable: () => true,
      filter: (_title: string, i: number) => i < 2,
    },
    {
      page: "Explorer_Map",
      namespacedId: "filled_map",
      stackSize: 64,
      renewable: (title: string) => title !== "Buried Treasure Map",
      filter: (_title: string, i: number) => i < 3,
    },
    {
      page: "Music_Disc",
      namespacedId: null,
      stackSize: 1,
      renewable: (title: string) => !["otherside", "Pigstep"].some((disc) => title.includes(disc)),
      filter: (_title: string) => true,
    },
  ];

  for (const { page, namespacedId, stackSize, renewable, filter } of pages) {
    await processSpecialItemPage(browser, page, namespacedId, stackSize, renewable, filter);
  }
  writeItems(items);
  console.log(chalk.blue("Finished processing special items"));
}

/**
 * Processes a special item page.
 */
async function processSpecialItemPage(
  browser: Browser,
  pageName: string,
  defaultNamespacedId: string | null,
  stackSize: number,
  isRenewable: (title: string) => boolean,
  filter: (title: string, index: number) => boolean
): Promise<void> {
  const pageUrl = `https://minecraft.wiki/w/${pageName}`;
  const itemPage: Page = await browser.newPage();
  try {
    await itemPage.goto(pageUrl, { timeout: 0, waitUntil: "networkidle2" });
    await itemPage.waitForSelector(".invslot-item");

    const itemsData: Array<{ name: string; imageUrl: string }> = await getSpecialItemsData(
      itemPage,
      filter
    );
    const description: string = await getDescription(itemPage);

    for (const itemData of itemsData) {
      let { name, imageUrl } = itemData;

      let updatedNamespacedId: string | null = defaultNamespacedId;
      let imageName: string = name.toLowerCase().replace(/ /g, "_");

      if (pageName === "Music_Disc") {
        const discName = name.split(" ").pop()?.toLowerCase().replace(")", "") || "unknown";
        name = `Music Disc (${name})`;
        updatedNamespacedId = `music_disc_${discName}`;
        imageName = updatedNamespacedId;
      }

      const imageExt = imageUrl.includes(".gif") ? "gif" : "png";
      if (name === "Potion") {
        throw new Error(imageUrl);
      }
      if (imageExt === "gif") {
        // download GIF and place in public/items
        await downloadGifImage(imageUrl, `${ITEMS_IMAGE_PATH}${imageName}.gif`);
      } else {
        await downloadImagePNG(imageUrl, imageName);
      }
      const imageTarget = `https://mc.geertvandrunen.nl/_new/items/${imageName}.${imageExt}`;

      items.push({
        name,
        namespacedId: updatedNamespacedId || "",
        description,
        image: imageTarget,
        renewable: isRenewable(name),
        stackSize,
      });

      writeItems(items);
      console.log(`Successfully added special item: ${name}`);
    }

    console.log(`Finished processing special items for page: ${pageName}`);
  } catch (error) {
    console.error(chalk.red(`Error processing special items for page: ${pageName}`), error);
  } finally {
    await itemPage.close();
  }
}

/**
 * Retrieves data for special items from a page.
 */
async function getSpecialItemsData(
  page: Page,
  filterFn: (title: string, index: number) => boolean
): Promise<Array<{ name: string; imageUrl: string }>> {
  return page.evaluate((filterFnString: string) => {
    const filter = new Function("title", "index", `return (${filterFnString})(title, index);`);
    const items = Array.from(document.querySelectorAll(".infobox-imagearea .invslot-item")).map(
      (item) => {
        let name;
        if (item.hasAttribute("data-minetip-title")) name = item.getAttribute("data-minetip-title");
        if (item.querySelector("span[title]"))
          name = item.querySelector("span[title]")?.getAttribute("title");
        if (item.querySelector("a[title]"))
          name = item.querySelector("a[title]")?.getAttribute("title");

        if (name.endsWith("Music Disc")) {
          const dataTipText = item.getAttribute("data-minetip-text") || "";
          name = dataTipText.replace("&7", "");
        }
        if (!name) name = "NO SPECIAL NAME";

        const img = item.querySelector("img") as HTMLImageElement | null;
        let imageUrl;
        if (img) {
          imageUrl = img.getAttribute("data-src") || img.src;
        }

        return { name, imageUrl };
      }
    );

    return items.filter(({ name }, index) => filter(name, index));
  }, filterFn.toString());
}

/**
 * Main execution function.
 */
(async () => {
  const browser = await initBrowser();
  try {
    const dataPage = await openDataPage(browser);
    await processRegularItems(browser, dataPage);
    await processSpecialItems(browser);
  } catch (error) {
    console.error(chalk.red("An unexpected error occurred:"), error);
  } finally {
    await browser.close();
  }
})();
