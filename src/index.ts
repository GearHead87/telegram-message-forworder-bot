import { botToken } from './constant.js';
// import express, { Request, Response } from "express";
// import axios from "axios";
// const app = express();

// app.use(express.json());

// app.listen(3000, () => {
//     console.log("Server is running on port 3000");
// });

// app.get("*", (req, res) => {
//     console.log(req.body);
//     res.send("Hello World");
// });

// app.post("*", (req, res) => {
//     console.log(req.body);
//     res.send("Hello World");
// });

// app.get('/setwebhook', (req, res) => {
//     res.send(`
//         <form action="/updatewebhook" method="GET">
//             <input type="text" name="url" placeholder="Enter webhook URL" style="padding: 5px; width: 300px;">
//             <button type="submit" style="padding: 5px 10px;">Update Webhook</button>
//         </form>
//     `);
// });

// app.get('/updatewebhook', async (req: Request, res: Response): Promise<void> => {
//     try {
//         const webhookUrl = req.query.url;
//         if (!webhookUrl) {
//             res.send('Please provide a webhook URL');
//             return;
//         }

//         const telegramApi = `https://api.telegram.org/bot${botToken}/setWebhook?url=${webhookUrl}`;

//         const response = await axios.get(telegramApi, {
//             headers: {
//                 'Content-Type': 'application/json'
//             }
//         });
//         res.send(`Webhook updated successfully: ${JSON.stringify(response.data)}`);
//     } catch (error) {
//         res.send(`Error updating webhook: ${error}`);
//     }
// });

import { Bot } from 'grammy';

console.log(botToken);

// Create an instance of the `Bot` class and pass your bot token to it.
const bot = new Bot(botToken); // <-- put your bot token between the ""

// You can now register listeners on your bot object `bot`.
// grammY will call the listeners when users send messages to your bot.

// Handle the /start command.
bot.command('start', async (ctx) => {
  await ctx.reply('Hi! I can only read messages that explicitly reply to me!', {
    // Make Telegram clients automatically show a reply interface to the user.
  });
});
// Handle other messages.
bot.on('message', (ctx) => ctx.reply('Got another message!'));

// Now that you specified how to handle messages, you can start your bot.
// This will connect to the Telegram servers and wait for messages.

// Start the bot.
bot.start();
