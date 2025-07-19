import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import dotenv from "dotenv";
import axios from "axios";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

dotenv.config();
const app = express();

app.use(cors());
app.use(bodyParser.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Schemas
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  email: { type: String, unique: true },
  password: String,
});

const GameSchema = new mongoose.Schema({
  id: Number,
  slug: String,
  name: String,
  description: String,
  background_image: String,
  genres: Array,
  platforms: Array,
  rating: Number,
  released: String,
  addedBy: String,
  addedAt: Date,
  website: String,
});

const ReviewSchema = new mongoose.Schema({
  gameId: { type: Number, required: true },
  username: { type: String, required: true },
  reviewText: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", UserSchema);
const Game = mongoose.model("Game", GameSchema);
const Review = mongoose.model("Review", ReviewSchema);

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Token missing" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

// Register
app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: "All fields are required" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    res.status(400).json({ error: "User already exists or invalid data" });
  }
});

// Login
app.post("/login", async (req, res) => {
  const { usernameOrEmail, password } = req.body;
  if (!usernameOrEmail || !password)
    return res.status(400).json({ error: "All fields are required" });

  try {
    const user = await User.findOne({
      $or: [{ email: usernameOrEmail }, { username: usernameOrEmail }],
    });

    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { id: user._id, username: user.username, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ message: "Login successful", token, user: { username: user.username, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

// Check user existence
app.get("/check-user", async (req, res) => {
  const login = req.query.login;
  if (!login) return res.status(400).json({ error: "Login query is required" });

  try {
    const user = await User.findOne({
      $or: [{ email: login }, { username: login }],
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({ username: user.username, email: user.email });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

// Save game (Requires Auth)
app.post("/save-game", verifyToken, async (req, res) => {
  const { gameData } = req.body;
  if (!gameData)
    return res.status(400).json({ error: "Game data required" });

  try {
    const newGame = new Game({
      id: gameData.id,
      slug: gameData.slug,
      name: gameData.name,
      description: gameData.description_raw || gameData.description,
      background_image: gameData.background_image,
      genres: gameData.genres,
      platforms: gameData.platforms,
      rating: gameData.rating,
      released: gameData.released,
      addedBy: req.user.username,
      addedAt: new Date(),
      website: gameData.website,
    });

    await newGame.save();
    res.status(201).json({ message: "Game saved" });
  } catch (err) {
    res.status(500).json({ error: "Failed to save game" });
  }
});

// Get suggested games
app.get("/suggested-games", async (req, res) => {
  try {
    const games = await Game.find().sort({ addedAt: -1 });
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch games" });
  }
});

// RAWG API fetch
async function fetchGameDetailsFromBackend(slug) {
  try {
    const response = await axios.get(`https://api.rawg.io/api/games/${slug}`, {
      params: { key: '9030709abcec4c239d8e479434b76ea5' }
    });
    return response.data;
  } catch (err) {
    return null;
  }
}

// Add yours (Requires Auth)
app.post("/addyours", verifyToken, async (req, res) => {
  const { gamename } = req.body;
  if (!gamename) return res.status(400).json({ error: "Game name is required" });

  try {
    const gameData = await fetchGameDetailsFromBackend(gamename);
    if (!gameData)
      return res.status(500).json({ error: "Failed to fetch game" });

    res.status(200).json({ success: true, data: gameData });
  } catch (err) {
    res.status(500).json({ error: "Internal error" });
  }
});

// Fetch RAWG game by slug
app.post("/fetch-game-details", async (req, res) => {
  const { slug } = req.body;
  if (!slug) return res.status(400).json({ error: "Missing slug" });

  try {
    const response = await axios.get(`https://api.rawg.io/api/games/${slug}`, {
      params: { key: '9030709abcec4c239d8e479434b76ea5' }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch game details" });
  }
});

// Add review (Requires Auth)
app.post("/add-review", verifyToken, async (req, res) => {
  const { gameId, reviewText } = req.body;

  if (!gameId || !reviewText)
    return res.status(400).json({ error: "Game ID and review text are required" });

  try {
    const review = new Review({
      gameId,
      username: req.user.username,
      reviewText,
    });

    await review.save();
    res.status(201).json({ message: "Review submitted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to submit review" });
  }
});

// Get reviews for a specific game
app.get("/reviews/:gameId", async (req, res) => {
  const gameId = parseInt(req.params.gameId);

  if (!gameId) return res.status(400).json({ error: "Invalid game ID" });

  try {
    const reviews = await Review.find({ gameId }).sort({ createdAt: -1 });
    res.status(200).json(reviews);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

// ✅ Start server - Render-compatible
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
});
