require("dotenv").config({ path: 'sigma.env' });
const express = require("express");
const session = require("express-session");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || '02fd08dcf2d730781150ace43eb8322180d751f77a60d576de5d7c2f655d75ef',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// EJS & static
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));

// OAuth2 login
app.get("/login", (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify%20email`;
  res.redirect(url);
});

app.get("/auth/discord/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("No code provided");

  try {
    const tokenRes = await axios.post("https://discord.com/api/oauth2/token", new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
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
  
  // Map URL parameters to display names in users.txt
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
    const productName = parts[4]; // Product name is the 5th part
    
    return userId === req.session.user.id && 
           productName === displayProductName;
  });

  if (!userHasAccess) {
    return res.status(403).send("You don't have access to this product. Make sure you've redeemed a key for it.");
  }

  // Map product names to their corresponding file names
  const productFiles = {
    'fortnite-private': 'fnpriv.rar',
    'fortnite-public': 'fnpub.rar',
    'temp-spoofer': 'temp.rar',
    'perm-spoofer': 'perm.rar'
  };

  const fileName = productFiles[product];
  if (!fileName) {
    return res.status(404).send("Product not found");
  }

  const filePath = path.join(__dirname, 'downloads', fileName);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('Download error:', err);
        res.status(500).send('Error downloading file');
      }
    });
  } else {
    res.status(404).send("This product is currently out of service (updating)");
  }
});

// Redeem key route
app.post('/redeem', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const { product, key } = req.body;
  const keyToRedeem = key.trim().toUpperCase();
  
  // Read all available keys
  const keyFile = `keys/${product.replace(/\s+/g, ' ').replace(/ /g, '%20')}.txt`;
  
  if (!fs.existsSync(keyFile)) {
    return res.status(400).render('error', { 
      title: 'Invalid Product',
      message: 'The selected product is invalid or not available.',
      user: req.session.user
    });
  }

  const keys = fs.readFileSync(keyFile, 'utf-8').split('\n').map(k => k.trim());
  const userKeys = fs.existsSync('keys/users.txt') ? fs.readFileSync('keys/users.txt', 'utf-8').split('\n') : [];
  
  // Check if key exists and is not used
  if (!keys.includes(keyToRedeem)) {
    return res.render('dashboard', { 
      user: req.session.user,
      products: ['Fortnite Private', 'Fortnite Public', 'Temp Spoofer', 'Perm Spoofer'],
      userKeys: userKeys,
      error: 'Invalid or already used key',
      product: product,
      key: key
    });
  }

  // Check if key is already used by someone
  if (userKeys.some(uk => uk.includes(keyToRedeem))) {
    return res.render('dashboard', { 
      user: req.session.user,
      products: ['Fortnite Private', 'Fortnite Public', 'Temp Spoofer', 'Perm Spoofer'],
      userKeys: userKeys,
      error: 'This key has already been used',
      product: product,
      key: key
    });
  }

  // Add to used keys
  const userData = `${req.session.user.id}=${req.session.user.username}=${req.session.user.email}=${keyToRedeem}=${product}`;
  userKeys.push(userData);
  fs.writeFileSync('keys/users.txt', userKeys.join('\n'));

  // Remove from available keys
  const updatedKeys = keys.filter(k => k !== keyToRedeem);
  fs.writeFileSync(keyFile, updatedKeys.join('\n'));

  res.render('dashboard', { 
    user: req.session.user,
    products: ['Fortnite Private', 'Fortnite Public', 'Temp Spoofer', 'Perm Spoofer'],
    userKeys: userKeys,
    success: 'Key successfully redeemed!',
    product: '',
    key: ''
  });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
