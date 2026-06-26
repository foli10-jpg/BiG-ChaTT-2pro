const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Databaza e përkohshme vetëm për menaxhimin e dhomave real-time
let onlineUsers = {}; 
let waitingUsers = []; 

// 💳 LIDHJA ME MONGODB ATLAS
// Render do ta marrë këtë automatikisht nëse e shton te Environment Variables, ose mund ta zëvendësosh këtu direkt me password-in tënd.
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://florian:PASSWORD_YT_KETU@flo.rcc9bqz.mongodb.net/bigchatt?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Sukses: U lidhëm me databazën MongoDB!"))
    .catch((err) => console.error("❌ Gabim gjatë lidhjes me databazën:", err));

// SCHEMA E PËRDORUESIT IN MONGODB
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true, lowercase: true },
    password: { type: String, required: true },
    name: String,
    surname: String,
    country: String,
    role: { type: String, default: 'user' },
    isVip: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
    banExpires: { type: mongoose.Schema.Types.Mixed, default: null } // Mund të jetë Date ose "permanent"
});
const User = mongoose.model('User', UserSchema);

// 🔐 ENDPOINT PËR REGJISTRIM (SIGN-UP)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, name, surname, country } = req.body;
        const existingUser = await User.findOne({ username: username.toLowerCase() });
        
        if (existingUser) {
            return res.status(400).json({ success: false, message: "Ky username është i zënë!" });
        }

        const newUser = new User({
            username, password, name, surname, country,
            role: username.toLowerCase() === 'florian' ? 'admin' : 'user' // Ti bëhesh Admin automatikisht
        });

        await newUser.save();
        return res.status(201).json({ success: true, user: newUser });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Gabim në server!" });
    }
});

// 🔐 ENDPOINT PËR KYÇJE (SIGN-IN)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username: username.toLowerCase() });

        if (!user || user.password !== password) {
            return res.status(400).json({ success: false, message: "Username ose Fjalëkalimi i gabuar!" });
        }

        // Kontrollo statusin e BAN-it para se të kyçet
        if (user.isBanned) {
            if (user.banExpires !== 'permanent' && Date.now() > new Date(user.banExpires).getTime()) {
                user.isBanned = false;
                user.banExpires = null;
                await user.save();
            }
        }

        return res.status(200).json({ success: true, user });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Gabim në server!" });
    }
});

// 💳 API PËR PAGESAT (VIP DHE UNBAN)
app.post('/api/payment', async (req, res) => {
    const { username, action } = req.body;
    try {
        const user = await User.findOne({ username: username.toLowerCase() });
        if (!user) return res.status(404).json({ success: false, message: "Përdoruesi nuk u gjet!" });

        if (action === "unban_payment") {
            user.isBanned = false;
            user.banExpires = null;
        } else {
            user.isVip = true;
        }

        await user.save();
        return res.status(200).json({ success: true, user });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Gabim gjatë pagesës!" });
    }
});

// 🌐 LOGJIKA REAL-TIME (SOCKET.IO)
io.on('connection', (socket) => {
    socket.on('user-online', (data) => {
        onlineUsers[socket.id] = {
            id: socket.id,
            username: data.username,
            peerId: data.peerId,
            country: data.country || 'Kosovë',
            isVip: data.isVip || false,
            inChat: false
        };
        io.emit('update-counter', Object.keys(onlineUsers).length);
    });

    socket.on('request-match', (data) => {
        let currentUser = onlineUsers[socket.id];
        if (!currentUser) return;

        currentUser.inChat = false;
        waitingUsers = waitingUsers.filter(id => id !== socket.id);

        const filterCountry = data ? data.filterCountry : 'all';

        // Matchmaking inteligjent sipas shtetit
        let partnerId = waitingUsers.find(id => {
            if (id === socket.id) return false;
            let p = onlineUsers[id];
            if (!p || p.inChat) return false;
            if (filterCountry !== 'all' && p.country !== filterCountry) return false;
            return true;
        });

        if (partnerId) {
            waitingUsers = waitingUsers.filter(id => id !== partnerId);

            onlineUsers[socket.id].inChat = true;
            onlineUsers[partnerId].inChat = true;
            onlineUsers[socket.id].partnerId = partnerId;
            onlineUsers[partnerId].partnerId = socket.id;

            socket.emit('match-found', onlineUsers[partnerId]);
            io.to(partnerId).emit('match-found', currentUser);
        } else {
            waitingUsers.push(socket.id);
        }
    });

    // Admin Ban Real-time
    socket.on('admin-ban-user', async (data) => {
        const targetUsername = data.target.toLowerCase();
        const duration = data.duration;

        let expiresAt = 'permanent';
        if (duration !== 'permanent') {
            expiresAt = new Date(Date.now() + (parseInt(duration) * 60 * 60 * 1000));
        }

        await User.findOneAndUpdate({ username: targetUsername }, { isBanned: true, banExpires: expiresAt });

        Object.keys(onlineUsers).forEach(id => {
            if (onlineUsers[id].username.toLowerCase() === targetUsername) {
                io.to(id).emit('banned-by-admin');
            }
        });
    });

    socket.on('disconnect', () => {
        let user = onlineUsers[socket.id];
        if (user && user.partnerId && onlineUsers[user.partnerId]) {
            onlineUsers[user.partnerId].inChat = false;
            io.to(user.partnerId).emit('opponent-disconnected');
        }
        delete onlineUsers[socket.id];
        waitingUsers = waitingUsers.filter(id => id !== socket.id);
        io.emit('update-counter', Object.keys(onlineUsers).length);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Serveri po punon në portin ${PORT}`));
