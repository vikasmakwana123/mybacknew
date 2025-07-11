import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import axios from 'axios';

import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set } from "firebase/database";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCgfVBx5s2gAZS8VwVLsPDn5rqcw_lTmrQ",
  authDomain: "game-hive-a0064.firebaseapp.com",
  databaseURL: "https://game-hive-a0064-default-rtdb.firebaseio.com",
  projectId: "game-hive-a0064",
  storageBucket: "game-hive-a0064.firebasestorage.app",
  messagingSenderId: "900172540827",
  appId: "1:900172540827:web:8aedd1b11b9ebc32944f3e",
  measurementId: "G-KT7RF1C43N",
};

// Initialize Firebase app
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);

const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(bodyParser.json());

// Register route — create user in Auth and save username+email in DB
app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: "Username, email, and password are required" });
  }

  try {
    // Create user in Firebase Authentication
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    // Save user details in Realtime Database
    await set(ref(database, "users/" + uid), {
      username,
      email,
    });

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Login route — accept username or email + password
app.post("/login", async (req, res) => {
  const { usernameOrEmail, password } = req.body;

  if (!usernameOrEmail || !password) {
    return res.status(400).json({ error: "Username/email and password are required" });
  }

  try {
    // Fetch all users from DB
    const snapshot = await get(ref(database, "users"));
    const users = snapshot.val() || {};

    // Find user by username or email
    const userEntry = Object.entries(users).find(
      ([uid, user]) => user.email === usernameOrEmail || user.username === usernameOrEmail
    );

    if (!userEntry) {
      return res.status(404).json({ error: "User not found" });
    }

    const [uid, user] = userEntry;

    // Sign in with Firebase Auth using email
    await signInWithEmailAndPassword(auth, user.email, password);

    res.status(200).json({
      message: "Login successful",
      user: { uid, username: user.username, email: user.email },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Check user existence route (for example: to verify if user exists before login)
app.get("/check-user", async (req, res) => {
  const loginInput = req.query.login;

  if (!loginInput) {
    return res.status(400).json({ error: "Login query parameter is required" });
  }

  try {
    const snapshot = await get(ref(database, "users"));
    const users = snapshot.val();

    if (!users) {
      return res.status(404).json({ error: "No users found" });
    }

    // Search for user by email or username
    const userEntry = Object.entries(users).find(
      ([uid, user]) => user.email === loginInput || user.username === loginInput
    );

    if (!userEntry) {
      return res.status(404).json({ error: "User not found" });
    }

    const [uid, user] = userEntry;

    res.json({
      uid,
      username: user.username,
      email: user.email,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save game to Firebase
app.post("/save-game", async (req, res) => {
  const { gameData, userId } = req.body;

  if (!gameData || !userId) {
    return res.status(400).json({ error: "Game data and user ID are required" });
  }

  try {
    // Check if the game already exists in the database
    const gameSnapshot = await get(ref(database, `suggested_games`));
    const games = gameSnapshot.val() || {};

    // Check if the game already exists by its name or any other unique identifier (like slug)
    const existingGame = Object.values(games).find(game => game.name === gameData.name || game.slug === gameData.slug);

    if (existingGame) {
      return res.status(400).json({ error: "This game is already added to the database" });
    }

    // Generate a unique ID for the game entry
    const gameId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Save the game to the suggested_games collection
    await set(ref(database, `suggested_games/${gameId}`), {
      id: gameData.id,
      slug: gameData.slug,
      name: gameData.name,
      description: gameData.description_raw || gameData.description,
      background_image: gameData.background_image,
      genres: gameData.genres,
      platforms: gameData.platforms,
      rating: gameData.rating,
      released: gameData.released,
      addedBy: userId,
      addedAt: new Date().toISOString(),
      website: gameData.website
    });

    res.status(201).json({ message: "Game saved successfully", gameId });
  } catch (error) {
    console.error("Error saving game:", error);
    res.status(500).json({ error: "Failed to save game" });
  }
});

// Get suggested games
app.get("/suggested-games", async (req, res) => {
  try {
    const snapshot = await get(ref(database, "suggested_games"));
    const games = snapshot.val() || {};

    // Convert to array and sort by addedAt (newest first)
    const gamesArray = Object.entries(games).map(([gameId, gameData]) => ({
      gameId,
      ...gameData
    })).sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

    res.json(gamesArray);
  } catch (error) {
    console.error("Error fetching suggested games:", error);
    res.status(500).json({ error: "Failed to fetch suggested games" });
  }
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
  console.log('Firebase initialized and ready');
});

// Function to fetch game details internally
async function fetchGameDetailsFromBackend(slug) {
  try {
    const response = await axios.get(`https://api.rawg.io/api/games/${slug}`, {
      params: {
        key: '9030709abcec4c239d8e479434b76ea5',
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching game details:', error.message);
    return null;
  }
}

app.post("/addyours", async (req, res) => {
  const { gamename, usernameOrEmail, password } = req.body;

  if (!usernameOrEmail || !password || !gamename) {
    return res.status(400).json({ error: "Username/email, password, and game name are required" });
  }

  try {
    const snapshot = await get(ref(database, "users"));
    const users = snapshot.val() || {};

    const user = Object.values(users).find(
      u => u.username === usernameOrEmail || u.email === usernameOrEmail
    );

    if (!user || user.password !== password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const gameData = await fetchGameDetailsFromBackend(gamename);

    if (!gameData) {
      return res.status(500).json({ error: "Failed to fetch game details" });
    }

    return res.status(200).json({ success: true, data: gameData });

  } catch (error) {
    console.error("Error in /addyours route:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /fetch-game-details route
app.post('/fetch-game-details', async (req, res) => {
  const { slug } = req.body;

  if (!slug) {
    return res.status(400).json({ error: 'Missing slug in request body' });
  }

  try {
    const response = await axios.get(`https://api.rawg.io/api/games/${slug}`, {
      params: {
        key: '9030709abcec4c239d8e479434b76ea5',
      },
    });

    res.json(response.data);
    console.log(response.data);
  } catch (error) {
    console.error('Failed to fetch game details:', error.message);
    res.status(500).json({ error: 'Failed to fetch game details' });
  }
});
