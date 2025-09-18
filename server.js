require("dotenv").config({ path: 'sigma.env' });
const express = require("express");
const session = require("express-session");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Session setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecretfallbackkey',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// EJS & static
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));

// Determine redirect URI dynamically
const isProduction = process.env.NODE_ENV === 'production';
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || (isProduction
  ? 'https://my-node-app-qwwr.onrender.com/auth/discord/callback'
  : 'http://localhost:3000/auth/discord/callback');

// Root route
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// Login route
app.get("/login", (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20email`;
  res.redirect(url);
});

// Discord OAuth callback
app.get("/auth/discord/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("No code provided");

  try {
    const tokenRes = await axios.post("https://discord.com/api/oauth2/token", new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      scope: "identify email"
    }), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    const userRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
    });

    req.session.user = userRes.data;
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.send("OAuth error");
  }
});

// Dashboard
app.get("/dashboard", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const products = ["Fortnite Private", "Fortnite Public", "Temp Spoofer", "Perm Spoofer"];
  const userKeys = fs.existsSync("keys/users.txt") ? fs.readFileSync("keys/users.txt", "utf-8").split("\n") : [];
  res.render("dashboard", { user: req.session.user, products, userKeys });
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// Download route
app.get("/download/:product", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const { product } = req.params;
  const userKeys = fs.existsSync("keys/users.txt") ? fs.readFileSync("keys/users.txt", "utf-8").split("\n") : [];

  const productNameMap = {
    'fortnite-private': 'Fortnite Private',
    'fortnite-public': 'Fortnite Public',
    'temp-spoofer': 'Temp Spoofer',
    'perm-spoofer': 'Perm Spoofer'
  };

  const displayProductName = productNameMap[product];
  const userHasAccess = userKeys.some(key => {
    const parts = key.split('=');
    const userId = parts[0];
    const productName = parts[4];
    return userId === req.session.user.id && productName === displayProductName;
  });

  if (!userHasAccess) return res.status(403).send("You don't have access to this product.");

  const productFiles = {
    'fortnite-private': 'fnpriv.rar',
    'fortnite-public': 'fnpub.rar',
    'temp-spoofer': 'temp.rar',
    'perm-spoofer': 'perm.rar'
  };

  const fileName = productFiles[product];
  if (!fileName) return res.status(404).send("Product not found");

  const filePath = path.join(__dirname, 'downloads', fileName);
  if (fs.existsSync(filePath)) {
    res.download(filePath, fileName, err => {
      if (err) {
        console.error('Download error:', err);
        res.status(500).send('Error downloading file');
      }
    });
  } else {
    res.status(404).send("This product is currently out of service.");
  }
});

// Redeem key
app.post("/redeem", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const { product, key } = req.body;
  const keyToRedeem = key.trim().toUpperCase();
  const keyFile = `keys/${product.replace(/\s+/g, ' ').replace(/ /g, '%20')}.txt`;

  if (!fs.existsSync(keyFile)) return res.status(400).render('error', { title: 'Invalid Product', message: 'Product not found.', user: req.session.user });

  const keys = fs.readFileSync(keyFile, 'utf-8').split('\n').map(k => k.trim());
  const userKeys = fs.existsSync('keys/users.txt') ? fs.readFileSync('keys/users.txt', 'utf-8').split('\n') : [];

  if (!keys.includes(keyToRedeem) || userKeys.some(uk => uk.includes(keyToRedeem))) {
    return res.render('dashboard', { 
      user: req.session.user,
      products: ['Fortnite Private', 'Fortnite Public', 'Temp Spoofer', 'Perm Spoofer'],
      userKeys,
      error: 'Invalid or already used key',
      product,
      key
    });
  }

  const userData = `${req.session.user.id}=${req.session.user.username}=${req.session.user.email}=${keyToRedeem}=${product}`;
  userKeys.push(userData);
  fs.writeFileSync('keys/users.txt', userKeys.join('\n'));

  const updatedKeys = keys.filter(k => k !== keyToRedeem);
  fs.writeFileSync(keyFile, updatedKeys.join('\n'));

  res.render('dashboard', { 
    user: req.session.user,
    products: ['Fortnite Private', 'Fortnite Public', 'Temp Spoofer', 'Perm Spoofer'],
    userKeys,
    success: 'Key successfully redeemed!',
    product: '',
    key: ''
  });
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
