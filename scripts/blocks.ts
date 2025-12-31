import puppeteer from "puppeteer";
import fs from "fs";
import pLimit from "p-limit";
import chalk from "chalk";
import Jimp from "jimp";
// @ts-ignore
import pixels from "image-pixels";
// @ts-ignore
import palette from "get-rgba-palette";

import { sortByKey } from "../utils";
import blocksJSON from "../data/blocks.json";
import { Block } from "../types";
import axios from "axios";
import sharp from "sharp";

const limit = pLimit(4);
const blocks = blocksJSON as Block[];

const notfoundlist: any[] = [];

const getTextContent = async (
  page: puppeteer.Page,
  element: puppeteer.ElementHandle,
  type?: string
) => {
  if (!element) {
    chalk.bgRedBright("Element not found", type);
    return "";
  }
  return await page.evaluate((element) => element.textContent, element);
};

const getItemPageUrl = async (namespaceId: string) => {
  console.log("getItemPageUrl", namespaceId);

  namespaceId = namespaceId.replace("exposed_", "");
  namespaceId = namespaceId.replace("oxidized_", "");
  namespaceId = namespaceId.replace("weathered", "");
  namespaceId = namespaceId.replace("weeping_", "");
  namespaceId = namespaceId.replace("waxed_", "");
  namespaceId = namespaceId.replace("potted_", "");

  if (namespaceId === "Beetroot_Seeds") {
    return "https://minecraft.wiki/w/Beetroot_Seeds";
  }
  if (namespaceId === "big_dripleaf_stem") {
    return "https://minecraft.wiki/w/Big_Dripleaf";
  }
  if (namespaceId.includes("carpet")) {
    return "https://minecraft.wiki/w/Carpet";
  }
  if (namespaceId.includes("shulker_box")) {
    return "https://minecraft.wiki/w/Shulker_Box";
  }
  if (namespaceId.includes("concrete_powder")) {
    return "https://minecraft.wiki/w/Concrete_Powder";
  }
  if (namespaceId.includes("concrete")) {
    return "https://minecraft.wiki/w/Concrete";
  }
  if (namespaceId.includes("bed")) {
    return "https://minecraft.wiki/w/Bed";
  }
  if (namespaceId.includes("jack_o_lantern")) {
    return "https://minecraft.wiki/w/Jack_o%27Lantern";
  }

  return "https://minecraft.wiki/w/" + namespaceId;
};

const writeBlocks = (blocks: Block[]) => {
  sortByKey(blocks, "name");
  fs.writeFileSync("data/blocks.json", JSON.stringify(blocks, null, 2));
};

const getItemNameForBlock = (name: string) => {
  const itemNameOverrides: Record<string, string> = {
    // item name differs from block name
    Beetroots: "Beetroot Seeds",
    Carrots: "Carrot",
    "Cave Vines": "Glow Berries",
    Cocoa: "Cocoa Beans",
    Lava: "Lava Bucket",
    "Melon Stem": "Melon Seeds",
    Potatoes: "Potato",
    "Powder Snow": "Powder Snow Bucket",
    "Pumpkin Stem": "Pumpkin Seeds",
    "Redstone Wire": "Redstone Dust",
    "Sweet Berry Bush": "Sweet Berries",
    Tripwire: "String",
    Water: "Water Bucket",
    "Wheat Crops": "Wheat Seeds",
    // growth variants
    "Bamboo Shoot": "Bamboo",
    "Cave Vines Plant": "Sweet Berries",
    "Kelp Plant": "Kelp",
    "Twisting Vines Plant": "Twisting Vines",
    "Weeping Vines Plant": "Weeping Vines",
    "Chorus Plant": "Chorus Flower",
  };
  const wallPlacements = ["Banner", "Head", "Torch", "Sign", "Fan", "Skull"];
  let itemName = itemNameOverrides[name] ?? name;
  if (wallPlacements.some((wallPlacement) => name.endsWith("Wall " + wallPlacement))) {
    wallPlacements.forEach((wallPlacement) => {
      itemName = itemName.replace("Wall " + wallPlacement, wallPlacement);
    });
  }
  return itemName;
};

(async () => {
  new Jimp(200, 200, "#00000000", (err, image) => {
    image.write("public/blocks/air.png");
  });

  async function downloadImagePNG(url: string, namespaceId: string): Promise<void> {
    // Fetch the image using Axios
    const response = await axios.get(url.replace("30px", "200px"), { responseType: "arraybuffer" });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch image. Status code: ${response.status}`);
    }

    const imageBuffer = Buffer.from(response.data, "binary");

    // Process the image with Sharp
    const resizedImageBuffer = await sharp(imageBuffer)
      .resize(200, 200, {
        fit: "inside",
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();

    // Ensure the directory exists
    const outputPath = `public/blocks/${namespaceId}.png`;
    await fs.promises.mkdir("public/blocks", { recursive: true });

    // Write the resized image
    await fs.promises.writeFile(outputPath, resizedImageBuffer);
    console.log(`Image saved to ${outputPath}`);
  }

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const dataPage = await browser.newPage();
  console.log("Opening data page...");
  await dataPage.goto("https://minecraft.wiki/w/Java_Edition_data_values/Blocks", {
    timeout: 0,
    waitUntil: "networkidle2",
  });
  console.log("Data page loaded");
  const explosionPage = await browser.newPage();
  await explosionPage.goto("https://minecraft.wiki/w/Explosion", {
    timeout: 0,
    waitUntil: "networkidle2",
  });
  console.log("Explosion page loaded");
  await Promise.all(
    (
      await dataPage.$$("body.page-Java_Edition_data_values_Blocks .stikitable tbody tr")
    ).map((row) =>
      limit(async (row) => {
        const td = await row.$("td:nth-child(3)");
        const name = (await getTextContent(dataPage, td, "name")).trim();
        let blockPage: puppeteer.Page;
        try {
          if (blocks.find((block) => block.name === name)) return;

          const itemFormID = await (
            await row.$("td:last-child")
          ).evaluate((el) => {
            return el.getAttribute("style")?.includes("#ccaaff") ? el.textContent : null;
          });

          const namespacedId =
            itemFormID || (await getTextContent(dataPage, await row.$("code"), "code"));

          let imageName = namespacedId;
          if (["Air", "Cave Air", "Void Air", "Moving Piston"].includes(name)) {
            imageName = "air";
          } else {
            const imageElement = await row.$("img");
            if (!imageElement) {
              console.log(chalk.red("No image found for block: " + name));
              return;
            }
            const wikiImageURL = await imageElement.evaluate((img: HTMLImageElement) => {
              const src = img.getAttribute("data-src") ?? img.src;
              return src.replace(/width-down.+/, "width-down/200");
            });
            if (wikiImageURL) {
              await downloadImagePNG(wikiImageURL, namespacedId);
            }
          }
          let image = `https://mc.geertvandrunen.nl/_new/blocks/${imageName}.png`;

          let item = null;
          const itemName = getItemNameForBlock(name);
          if (itemName !== name) {
            item = itemName;
          }

          const url = await getItemPageUrl(namespacedId);
          blockPage = await browser.newPage();
          console.log("Opening block page: " + name, url);
          await blockPage.goto(url, {
            timeout: 0,
            waitUntil: "networkidle2",
          });

          const noContent = await blockPage.$(".noarticletext");
          if (noContent) {
            console.log(chalk.blue("No content found for block: " + name));
            notfoundlist.push(name);
            await blockPage.close();
            return;
          }

          console.log(" getting description");

          const description = await blockPage.evaluate(() => {
            return new Promise<string>((resolve) => {
              const interval = setInterval(() => {
                const meta = document.head.querySelector('meta[name="description"]');
                const content = meta?.getAttribute("content");

                if (content && content !== "MediaWiki host for official and independent wikis") {
                  clearInterval(interval);
                  resolve(content);
                  console.log("got it");
                }
              }, 100);
            });
          });

          const block: Block = {
            name,
            namespacedId,
            description,
            image,
            item,
            tool: undefined,
            flammable: undefined,
            transparent: undefined,
            luminance: undefined,
            blastResistance: undefined,
            colors: undefined,
          };
          const types: { blocks: string[]; attributes: Partial<Block> }[] = [
            {
              blocks: ["Lava", "Water", "Powder Snow"],
              attributes: {
                flammable: false,
                tool: null,
                // requiresTool: false,
                // requiresSilkTouch: false,
              },
            },
            {
              blocks: ["Sweet Berry Bush"],
              attributes: {
                flammable: true,
                // requiresTool: false,
                // requiresSilkTouch: false,
              },
            },
            {
              blocks: ["Sea Pickle"],
              attributes: {
                luminance: 6,
              },
            },
            {
              blocks: ["Redstone Dust"],
              attributes: {
                // requiresTool: false,
                // requiresSilkTouch: false,
              },
            },
            {
              blocks: ["Redstone Torch", "Redstone Wall Torch"],
              attributes: {
                luminance: 7,
              },
            },
            {
              blocks: ["Redstone Ore"],
              attributes: {
                luminance: 9,
              },
            },
            {
              blocks: ["Carrots", "Potatoes"],
              attributes: {
                transparent: true,
                luminance: 0,
                flammable: true,
                tool: null,
                // requiresTool: false,
                // requiresSilkTouch: false,
              },
            },
            {
              blocks: ["Moving Piston", "Piston Head"],
              attributes: {
                // requiresTool: false,
                // requiresSilkTouch: false,
              },
            },
            {
              blocks: ["Melon"],
              attributes: {
                tool: "Axe",
              },
            },
            {
              blocks: ["Magma Block"],
              attributes: {
                flammable: false,
              },
            },
            {
              blocks: ["Iron "],
              attributes: {
                tool: "Pickaxe",
              },
            },
            {
              blocks: [
                "Enchanting Table",
                "Cauldron",
                "Red Mushroom",
                "Observer",
                "Blue Ice",
                " Head",
                "Skull",
                "Spawner",
                "Cake",
              ],
              attributes: {
                luminance: 0,
              },
            },
            {
              blocks: ["Fletching Table"],
              attributes: {
                flammable: false,
              },
            },
            {
              blocks: ["Dead Bush"],
              attributes: {
                flammable: true,
              },
            },
            {
              blocks: ["Cobweb"],
              attributes: {
                tool: "Shears",
              },
            },
            {
              blocks: ["Brown Mushroom"],
              attributes: {
                luminance: 1,
              },
            },
            {
              blocks: ["Beehive", "Bee Nest"],
              attributes: {
                flammable: true,
                luminance: 0,
              },
            },
            {
              blocks: ["Furnace", "Smoker"],
              attributes: {
                luminance: 13,
              },
            },
            {
              blocks: ["Soul Fire"],
              attributes: {
                luminance: 10,
              },
            },
            {
              blocks: ["Torch"],
              attributes: {
                luminance: 14,
              },
            },
            {
              blocks: ["Candle", "Cake with"],
              attributes: {
                luminance: 3,
              },
            },
            {
              blocks: ["Fire", "Lantern", "Redstone Lamp", "Campfire", "Respawn Anchor"],
              attributes: {
                luminance: 15,
              },
            },
            {
              blocks: ["Bedrock"],
              attributes: {
                transparent: false,
                flammable: false,
              },
            },
            {
              blocks: ["Weighted Pressure Plate"],
              attributes: {
                tool: "Pickaxe",
                // requiresTool: true,
                // requiresSilkTouch: false,
              },
            },
            {
              blocks: ["Bamboo Shoot"],
              attributes: {
                flammable: false,
              },
            },
            {
              blocks: ["Coral Fan", "Coral Wall Fan"],
              attributes: {
                // requiresTool: false,
                // requiresSilkTouch: true,
              },
            },
            {
              blocks: ["Pumpkin Stem"],
              attributes: {
                blastResistance: 0,
              },
            },
            {
              blocks: ["Carpet"],
              attributes: {
                flammable: true,
              },
            },
            {
              blocks: ["Shulker Box"],
              attributes: {
                // requiresTool: false,
                // requiresSilkTouch: false,
              },
            },
            {
              blocks: [
                "Dandelion",
                "Poppy",
                "Blue Orchid",
                "Allium",
                "Azure Bluet",
                "Red Tulip",
                "Orange Tulip",
                "White Tulip",
                "Pink Tulip",
                "Oxeye Daisy",
                "Cornflower",
                "Lily of the Valley",
                "Wither Rose",
                "Sunflower",
                "Lilac",
                "Rose Bush",
                "Peony",
              ],
              attributes: {
                flammable: true,
              },
            },
            {
              blocks: ["Stairs", "Slab"],
              attributes: {
                transparent: true,
              },
            },
            {
              blocks: ["Leaves", "Glow Lichen"],
              attributes: {
                blastResistance: 0.2,
                transparent: true,
                tool: "Shears",
                // requiresTool: true,
              },
            },
            {
              blocks: [" Wood", "Log"],
              attributes: {
                blastResistance: 2,
                flammable: true,
                // requiresTool: false,
                // requiresSilkTouch: false,
              },
            },
            {
              blocks: ["Stem", "Hyphae"],
              attributes: {
                blastResistance: 2,
                flammable: false,
                // requiresTool: false,
                // requiresSilkTouch: false,
              },
            },
            {
              blocks: ["Oak", "Spruce", "Birch", "Jungle", "Acacia", "Crimson", "Warped"],
              attributes: {
                blastResistance: 3,
                flammable: true,
                tool: "Axe",
              },
            },
            {
              blocks: ["Oak", "Spruce", "Birch", "Jungle", "Acacia"],
              attributes: {
                flammable: true,
              },
            },
            {
              blocks: ["Crimson", "Warped"],
              attributes: {
                flammable: false,
              },
            },
            {
              blocks: [
                "Stone ",
                "Cobblestone",
                "Sandstone",
                "Diorite",
                "Andesite",
                "Granite",
                "Prismarine",
                "Brick",
                "Purpur",
                "Quartz",
                "Blackstone",
                "Deepslate",
              ],
              attributes: {
                flammable: false,
                tool: "Pickaxe",
                // requiresTool: true,
                // requiresSilkTouch: false,
              },
            },
            {
              blocks: ["Quartz"],
              attributes: {
                blastResistance: 0.8,
              },
            },
            {
              blocks: ["Copper"],
              attributes: {
                blastResistance: 6,
                tool: "Pickaxe",
              },
            },
            {
              blocks: ["Small Amethyst Bud"],
              attributes: {
                luminance: 1,
              },
            },
            {
              blocks: ["Medium Amethyst Bud"],
              attributes: {
                luminance: 2,
              },
            },
            {
              blocks: ["Large Amethyst Bud"],
              attributes: {
                luminance: 4,
              },
            },
            {
              blocks: ["Amethyst Cluster"],
              attributes: {
                luminance: 5,
              },
            },
            {
              blocks: ["Cave Vines"],
              attributes: {
                luminance: 14,
              },
            },
            {
              blocks: ["Light"],
              attributes: {
                luminance: 15,
              },
            },
          ];

          for (const type of types) {
            if (type.blocks.some((block) => name.includes(block))) {
              for (const attribute in type.attributes) {
                const key = attribute as keyof Block;
                if (block[key] === undefined) {
                  (block as any)[key] = type.attributes[key];
                }
              }
            }
          }

          const elem = await blockPage.$("table.infobox-rows tr:nth-child(4) td p");

          block.blastResistance = await getTextContent(blockPage, elem, "blastResistance");
          block.blastResistance = parseInt(block.blastResistance.toString().trim());

          // if (block.tool === undefined) {
          //   // MULTIPLE TOOL TYPES RETURNS UNDEFINED
          //   block.tool = (await blockPage.evaluate(() => {
          //     const toolRow = [...document.querySelectorAll(".infobox-rows tr")].filter(
          //       (row: HTMLTableRowElement) => row.innerText.includes("Tool")
          //     )[0];
          //     console.log("TOOLROW", toolRow);
          //     if (!toolRow) return null;
          //     const tools = [...toolRow.querySelectorAll("a")];
          //     const allTools = ["Pickaxe", "Hoe", "Axe", "Shovel", "Sword", "Shears"];
          //     return tools.length === 0
          //       ? null
          //       : tools.length > 1 || !allTools.includes(tools[0].title)
          //       ? undefined
          //       : tools[0].title;
          //   })) as Block["tool"];
          // }
          // if (missingAttribute("tool")) return;

          // disabled requiresTool and requiresSilkTouch since the information has been moved to
          // https://minecraft.fandom.com/wiki/Breaking and https://minecraft.fandom.com/wiki/Silk_Touch
          // TODO: add hardness instead of requiresTool?

          try {
            block.colors = (
              palette.bins((await pixels(`public/blocks/${imageName}.png`)).data) as {
                color: [number, number, number];
                amount: number;
              }[]
            )
              .map(({ color, amount }) => ({
                color,
                amount: Math.round(amount * 1000) / 1000,
              }))
              .filter((color) => color.amount > 0.01);
          } catch (e) {
            console.log(chalk.red("Error when getting block colors for: " + block.name));
            await blockPage.close();
            return;
          }

          await blockPage.close();
          blocks.push(block);
          writeBlocks(blocks);
          console.log("Successfully added block: " + name);
        } catch (e) {
          console.log(chalk.red("Uncaught error when getting block: " + name));
          console.log(e);
          if (blockPage) await blockPage.close();
          // stop the script if an error occurs
          Promise.reject(e);

          return;
        }
      }, row)
    )
  );
  writeBlocks(blocks);
  console.log(chalk.blue("Finished getting all blocks"));

  console.log("Not found list");
  notfoundlist?.map((name) => console.log(name));
})();
