const axios = require('axios');
const cheerio = require('cheerio');
const countries = require('iso-3166-1-alpha-2');
const discord = require('discord.js');
const { EmbedBuilder, Client, Intents, Events } = require('discord.js');
const https = require('https');
const fs = require('fs');
const moment = require('moment')

// Read the config file
const configFile = fs.readFileSync('config.json', 'utf8');

// Parse the JSON content
const config = JSON.parse(configFile);

const ADMIN = config.ADMIN;
const TOKEN = config.TOKEN;
const WEBHOOK_URLS = config.WEBHOOK_URLS;

const client = new Client({
  intents: 3276799
});

const raffleIds = new Set();

async function initializeRaffleIds() {
  const initialRaffles = await fetchRaffles();
  for (const product of initialRaffles) {
    for (const raffle of product.raffle) {
      const raffleId = raffle.id;
      raffleIds.add(raffleId);
    }
  }
}

client.on('error', (error) => {
  console.error('An error occurred:', error);
});

client.on('ready', async () => {
  console.log(`${client.user.username} has connected to Discord!`);
  await initializeRaffleIds();
  checkRaffles();
});

client.on('messageCreate', async (message) => {
  if (message.content.startsWith('!add_webhook') && message.author.id === ADMIN) {
    const args = message.content.split(' ');
    if (args.length === 2) {
      const webhookUrl = args[1];
      addWebhookUrl(webhookUrl);
      const success_message = await message.channel.send(`Webhook URL has been added.`);
      await message.delete();
      setTimeout(async () => {
        await success_message.delete();
      }, 5000);
    } else {
      await message.channel.send('Invalid command usage. Please provide a single webhook URL.');
    }
  } else if (message.content === '!test' && message.author.id === ADMIN) {
    await testFunction(message);
  }

});

function addWebhookUrl(webhookUrl) {
  WEBHOOK_URLS.push(webhookUrl);
  updateConfig();
}

function updateConfig() {
  const updatedConfig = { ...config, WEBHOOK_URLS };
  fs.writeFileSync('config-beta.json', JSON.stringify(updatedConfig, null, 2));
}

async function fetchRaffles() {
  const headers = {
    'Pragma': 'no-cache',
    'Accept': '*/*',
    'Cache-Control': 'no-cache',
    'Host': 'www.soleretriever.com',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36',
    'Referer': 'https://www.soleretriever.com/raffles'
  };

  const url = 'https://76.76.21.21/api/products/raffles?term=&from=0&limit=24&locales=WW,US&types=&isHideEntered=true';

  try {
    const response = await axios.get(url, { headers, httpsAgent: new https.Agent({ rejectUnauthorized: false }) });

    if (response.status === 200) {
      const data = response.data;
      const products = data.products;
      return products;
    } else {
      console.log('Error fetching raffles: Empty response.');
      return [];
    }
  } catch (error) {
    console.log(`Error fetching raffles: ${error}`);
    return [];
  }
}

async function sendEmbeddedMessage(title, image_url, raffle_url, price) {
  const headers = {
    'Pragma': 'no-cache',
    'Accept': '*/*',
    'Cache-Control': 'no-cache',
    'Host': 'www.soleretriever.com',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36'
  };

  try {
    const response = await axios.get(raffle_url, { headers, httpsAgent: new https.Agent({ rejectUnauthorized: false }) });
    const raffle_response_content = response.data;

    const $ = cheerio.load(raffle_response_content);

    let start_date = $('.font-mono:contains("Start date")').next().text();
    let close_date = $('.font-mono:contains("Close date")').next().text();
    let raffle_type = $('.font-mono:contains("Type")').next().text();
    let region = $('.font-mono:contains("Region")').next().text();
    let retrieval = $('.font-mono:contains("Retrieval")').next().text();

    const target_div = $('div.flex.flex-col.text-md');
    const retailer_link = target_div.find('a[href]').attr('href');
    const retailer_name_element = $('a.flex.items-center');
    const retailer_name = retailer_name_element.find('h2').text().replace("Raffle by ", "").trim().replace(/\.$/, '');
    if (close_date !== "TBA" && !close_date.includes("Closed")) {
      try {
        const initial_datetime = moment(close_date, "MMMM DD, hh:mm A");
        const updated_datetime = initial_datetime.subtract(4, 'hours');
        close_date = updated_datetime.format("MMMM DD, hh:mm A");
      } catch (error) {
        console.log(error);
      }
    }
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setURL(retailer_link)
      .setDescription(`A new raffle for ${title} is live!`)
      .setColor(0x68CD89)
      .setThumbnail(image_url)
      .addFields([
        { name: "Region", value: `${getFlagEmoji(region)} ${region}`, inline: true },
        { name: "Type", value: raffle_type, inline: true },
        { name: "Store", value: retailer_name, inline: true },
        { name: "Open", value: start_date, inline: true },
        { name: "Close", value: close_date, inline: true },
        { name: "Delivery", value: getDeliveryEmoji(retrieval), inline: true },
        { name: "Entry:", value: `[Enter at ${retailer_name}](${retailer_link})`, inline: true },
        { name: "Price:", value: `$${price}`, inline: true },
      ])
      .setFooter({ text: "Swift Raffles", iconURL: "https://cdn.discordapp.com/attachments/1088524740693606480/1105587682572251178/swift_mail.png"})
      .setTimestamp(new Date());

    const webhook_payload = {
      embeds: [embed],
      username: "Swift Raffles",
      avatar_url: "https://cdn.discordapp.com/attachments/1088524740693606480/1105587682572251178/swift_mail.png"
    };

    const tasks = [];
    for (const webhook_url of WEBHOOK_URLS) {
      const task = sendWebhook(webhook_url, webhook_payload);
      tasks.push(task);
    }

    await Promise.all(tasks);
  } catch (error) {
    console.log(`Error sending embedded message: ${error.message}`);
  }
}


async function sendWebhook(webhookUrl, webhookPayload) {
  try {
    const response = await axios.post(webhookUrl, webhookPayload);
  } catch (e) {
    console.log(`Error sending webhook to ${webhookUrl}: ${e}`);
  }
}

function getFlagEmoji(region) {
  const regionFlags = {
    Worldwide: ":globe_with_meridians:",
    Europe: ":flag_eu:",
  };

  if (region in regionFlags) {
    return regionFlags[region];
  }

  try {
    const country_code = countries.getCode(region);
    const flagEmoji = `:flag_${country_code.toLowerCase()}:`
    return flagEmoji;
  } catch (error) {
    return "";
  }
}
  
function getDeliveryEmoji(retrieval) {
  switch (retrieval) {
    case "Shipping":
      return ":package: " + retrieval;
    case "In store pickup":
      return ":door: " + retrieval;
    default:
      return ":white_check_mark: " + retrieval;
  }
}

async function checkRaffles() {
  const newRaffles = await fetchRaffles();

  for (const product of newRaffles) {
    const productName = product.name;
    const productSlug = product.slug;
    const productImageUrl = product.imageUrl;
    const price = product.price;

    for (const raffle of product.raffle) {
      const raffleId = raffle.id;
      
      if (!raffleIds.has(raffleId)) {
        raffleIds.add(raffleId);
        const raffleUrl = `https://76.76.21.21/raffles/${productSlug}/raffle/${raffleId}`;
        await sendEmbeddedMessage(productName, productImageUrl, raffleUrl, price);
      }
    }
  }

  console.log("Raffles are being checked for updates");
}
  
async function testFunction(message) {
  try {
    const products = await fetchRaffles();
    if (products.length > 0) {
      const testRaffleUrl = `https://76.76.21.21/raffles/${products[0].slug}/raffle/${products[0].raffle[0].id}`;
      const testProductName = products[0].name;
      const testImageUrl = products[0].imageUrl;
      const testPrice = products[0].price;
  
      await sendEmbeddedMessage(testProductName, testImageUrl, testRaffleUrl, testPrice);
      await message.delete();
      const success_message = await message.channel.send("Test webhook sent.");
      setTimeout(async () => {
        await success_message.delete();
      }, 5000);
    } else {
      await message.channel.send("Test failed.");
    }
  } catch (error) {
    // Handle request exception/error
    console.error("Test function error:", error);
  }
}

async function bot() {
  // Schedule periodic checks for new raffles
  await setInterval(checkRaffles, CHECK_INTERVAL);
}
  
// Define the interval (in milliseconds) for checking new raffles
const CHECK_INTERVAL = 60000; // 1 minute

  
// Start the bot
bot();

client.login(TOKEN);