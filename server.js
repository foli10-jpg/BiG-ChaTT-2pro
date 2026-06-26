const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*", // Lejon lidhjen nga Netlify dhe çdo pajisje tjetër
        methods: ["GET", "POST"]
    }
});

// Lista e përdoruesve që janë online dhe të lirë për bisedë
let onlineUsers = {}; 

app.get('/', (req, res) => {
    res.send("Serveri Backend i BiG CHaTT është LIVE! 🟢");
});

io.on('connection', (socket) => {
    console.log(`Një përdorues u lidh: ${socket.id}`);

    // 1. Kur përdoruesi hyn në aplikacion (Auth u krye me sukses)
    socket.on('user-online', (data) => {
        socket.username = data.username;
        socket.peerId = data.peerId;
        socket.city = data.city;
        socket.isVip = data.isVip;
        socket.isSearching = false; // Nuk po kërkon dhomë ende

        // Ruajmë të dhënat e socket-it
        onlineUsers[socket.id] = socket;

        // Dërgojmë numrin e saktë të përdoruesve online te të gjithë
        io.emit('update-counter', Object.keys(onlineUsers).length);
    });

    // 2. Kur përdoruesi shtyp butonin 'SKIP' (Kërkon match)
    socket.on('request-match', () => {
        if (!onlineUsers[socket.id]) return;

        // Ndërpremë ndonjë match të vjetër nëse ka qenë i lidhur
        if (socket.currentOpponent) {
            let oldOpponent = onlineUsers[socket.currentOpponent];
            if (oldOpponent) {
                oldOpponent.emit('opponent-disconnected');
                oldOpponent.currentOpponent = null;
                oldOpponent.isSearching = true;
            }
            socket.currentOpponent = null;
        }

        socket.isSearching = true;

        // Algoritmi i Matchmaking-ut Real:
        // Kërkojmë dikë tjetër që po kërkon dhomë TANI dhe nuk është vetë ky përdorues
        let availableOpponent = null;
        for (let id in onlineUsers) {
            if (id !== socket.id && onlineUsers[id].isSearching) {
                availableOpponent = onlineUsers[id];
                break;
            }
        }

        if (availableOpponent) {
            // Nëse gjetëm dikë, i lidhim të dy bashkë!
            socket.isSearching = false;
            availableOpponent.isSearching = false;

            socket.currentOpponent = availableOpponent.id;
            availableOpponent.currentOpponent = socket.id;

            // I dërgojmë frontend-it të secilit të dhënat e tjetrit për të bërë thirrjen WebRTC
            socket.emit('match-found', {
                username: availableOpponent.username,
                peerId: availableOpponent.peerId,
                city: availableOpponent.city,
                isVip: availableOpponent.isVip
            });

            availableOpponent.emit('match-found', {
                username: socket.username,
                peerId: socket.peerId,
                city: socket.city,
                isVip: socket.isVip
            });
            
            console.log(`Match i suksesshëm: ${socket.username} <--> ${availableOpponent.username}`);
        }
    });

    // 3. Kur përdoruesi shtyp 'Stop' ose del nga faqja
    socket.on('leave-match', () => {
        socket.isSearching = false;
        if (socket.currentOpponent) {
            let opponent = onlineUsers[socket.currentOpponent];
            if (opponent) {
                opponent.emit('opponent-disconnected');
                opponent.currentOpponent = null;
            }
            socket.currentOpponent = null;
        }
    });

    // 4. Kur Admini (Ti) i bën dikujt BAN nga paneli
    socket.on('admin-ban-user', (data) => {
        // Kërkojmë nëse përdoruesi i bllokuar është online tani dhe e nxjerrim jashtë direkt
        for (let id in onlineUsers) {
            if (onlineUsers[id].username === data.target) {
                onlineUsers[id].emit('opponent-disconnected');
                // I dërgojmë komandën që t'i shfaqet ekrani i zi i BAN-it
                io.to(id).emit('banned-by-admin'); 
                onlineUsers[id].disconnect();
            }
        }
    });

    // Kur përdoruesi mbyll faqen ose shkëputet nga interneti
    socket.on('disconnect', () => {
        if (socket.currentOpponent) {
            let opponent = onlineUsers[socket.currentOpponent];
            if (opponent) {
                opponent.emit('opponent-disconnected');
                opponent.currentOpponent = null;
            }
        }
        delete onlineUsers[socket.id];
        // Përditësojmë numëruesin për të tjerët
        io.emit('update-counter', Object.keys(onlineUsers).length);
        console.log(`Një përdorues doli: ${socket.id}`);
    });
});

// Porti i cili rregullohet automatikisht nga Render
const PORT = process.env.PORT || 10000;
http.listen(PORT, () => {
    console.log(`Serveri BiG CHaTT po punon në portin ${PORT}`);
});
