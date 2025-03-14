const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const sharp = require('sharp');
const path = require('path');
const { Pool } = require('pg'); // Importer le client PostgreSQL
const exiftool = require('exiftool-vendored').exiftool;
const bcrypt = require('bcrypt'); // Pour hacher les mots de passe
const jwt = require('jsonwebtoken'); // Pour générer des tokens JWT
const { v4: uuidv4 } = require('uuid'); // Pour générer des UUID

const app = express();

// Middleware pour parser les corps de requête au format JSON
app.use(express.json());

// Configuration de multer pour stocker les fichiers dans le répertoire 'uploads'
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // Répertoire de destination
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname); // Renommer le fichier avec un timestamp
    }
});
const upload = multer({ storage: storage });

// Configuration de la connexion à PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '7718',
    database: process.env.DB_NAME || 'testK',
    port: process.env.DB_PORT || 5432
});

// Middleware CORS
app.use(cors({ origin: 'http://localhost:8081', credentials: true }));

// Fonction pour initialiser la base de données (créer la table si elle n'existe pas)
async function initializeDatabase() {
    try {
        const query = `
            CREATE TABLE IF NOT EXISTS images (
                id TEXT PRIMARY KEY,
                original_name TEXT NOT NULL,
                watermarked_name TEXT NOT NULL,
                metadata TEXT NOT NULL,
                image_data BYTEA NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                email TEXT NOT NULL,
                type_u TEXT NOT NULL,
                password TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                update_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                create_by TEXT NOT NULL
            );
        `;
        await pool.query(query);
        // console.log('Tables "images" et "users" créées ou déjà existantes.');
    } catch (error) {
        console.error('Erreur lors de la création des tables :', error);
    }
}

// Appeler la fonction d'initialisation au démarrage du serveur
initializeDatabase();

// Route pour l'inscription
app.post('/signup', async (req, res) => {
    const { username, email, type_u, password, create_by } = req.body;

    // Valider les champs obligatoires
    if (!username || !password || !email) {
        return res.status(400).json({ message: 'Username, password, and email are required.' });
    }

    // Générer un ID unique et hacher le mot de passe
    const id = uuidv4();
    const saltRounds = 10;
    const created_at = new Date();
    const update_at = new Date();
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Préparer la requête SQL
    const query = 'INSERT INTO users (id, username, email, type_u, password, created_at, update_at, create_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)';
    const values = [id, username, email, type_u, hashedPassword, created_at, update_at, create_by];

    try {
        const { rows } = await pool.query(query, values);

        // Supposons que la base de données retourne l'ID de l'utilisateur créé
        const createdUserId = rows[0]?.id;

        res.status(201).json({ message: 'Utilisateur créé avec succès', createdUserId });
    } catch (error) {
        console.error('Erreur lors de l\'inscription :', error);
        res.status(500).json({ message: 'Erreur interne du serveur.' });
    }
});

// Route pour la connexion
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const query = 'SELECT * FROM users WHERE email = $1';
        const { rows } = await pool.query(query, [email]);

        if (rows.length === 1) {
            const user = rows[0];

            const isPasswordValid = await bcrypt.compare(password, user.password);

            if (isPasswordValid) {
                const token = jwt.sign({ userId: user.id, userName: user.username }, '77181753');
                const userId = user.id;
                const userName = user.username;

                res.json({ token, userId, userName });
            } else {
                res.status(401).json({ message: 'Mot de passe incorrect' });
            }
        } else {
            res.status(404).json({ message: 'Utilisateur non trouvé' });
        }
    } catch (error) {
        console.error('Erreur lors de la connexion :', error);
        res.status(500).json({ message: 'Erreur interne du serveur.' });
    }
});

// Fonction pour insérer des métadonnées à une image
async function insertMetadata(imagePath, metadata, outputPath) {
    try {
        // Vérifiez que le fichier existe
        if (!fs.existsSync(imagePath)) {
            console.error('Le fichier n\'existe pas :', imagePath);
            return;
        }

        // Copier d'abord le fichier
        fs.copyFileSync(imagePath, outputPath);

        // Utiliser exiftool pour ajouter les métadonnées
        await exiftool.write(outputPath, {
            UserComment: metadata
        });

        console.log('Métadonnées insérées avec succès !');
    } catch (error) {
        console.error('Erreur lors de l\'insertion des métadonnées :', error);
        throw error; // Propager l'erreur pour pouvoir la gérer dans la route
    }
}

// Fonction pour extraire les métadonnées
async function extractMetadata(imagePath) {
    try {
        const metadata = await exiftool.read(imagePath);
        console.log('Métadonnées complètes:', metadata);

        return metadata.UserComment || 'Aucune métadonnée trouvée';
    } catch (error) {
        console.error('Erreur lors de l\'extraction des métadonnées :', error);
        return null;
    }
}

// Endpoint pour uploader une image avec des métadonnées personnalisées
app.post('/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send('Aucun fichier uploadé.');

        const filePath = req.file.path;
        // Obtenir l'extension correcte basée sur le type MIME
        const fileExt = req.file.mimetype.split('/')[1];
        // Créer un nom de fichier cohérent avec le type réel
        const outputPath = `uploads/tatouee_${path.parse(req.file.filename).name}.${fileExt}`;

        // Récupérer les métadonnées depuis le formulaire
        const metadata = req.body.metadata || 'ID_Patient:12345'; // Valeur par défaut si non spécifiée

        await insertMetadata(filePath, metadata, outputPath);

        // Lire l'image tatouée en tant que fichier binaire
        const imageData = fs.readFileSync(outputPath);

        // Insérer l'image et les métadonnées dans PostgreSQL
        const query = `
            INSERT INTO images (original_name, watermarked_name, metadata, image_data)
            VALUES ($1, $2, $3, $4)
            RETURNING id;
        `;
        const values = [req.file.originalname, outputPath, metadata, imageData];

        const result = await pool.query(query, values);

        res.status(200).send({
            message: 'Fichier uploadé, tatoué et stocké dans la base de données avec succès !',
            original: filePath,
            watermarked: outputPath,
            metadata: metadata,
            imageId: result.rows[0].id // Retourner l'ID de l'image insérée
        });
    } catch (error) {
        console.error('Erreur lors du traitement du fichier :', error);
        res.status(500).send('Erreur interne du serveur.');
    }
});

// Endpoint pour vérifier et extraire les métadonnées
app.post('/verify', upload.single('image'), async (req, res) => {
    console.log('Fichier reçu pour vérification :', req.file); // Log pour voir le fichier reçu
    try {
        if (!req.file) return res.status(400).send('Aucun fichier uploadé.');

        const filePath = req.file.path; // Chemin de l'image téléchargée
        const metadata = await extractMetadata(filePath); // Extraction des métadonnées

        res.status(200).send({ message: 'Métadonnées extraites avec succès !', metadata });
        console.log(metadata);

    } catch (error) {
        console.error('Erreur lors de l\'extraction des métadonnées :', error);
        res.status(500).send('Erreur interne du serveur.');
    }
});

// Endpoint pour récupérer toutes les images
app.get('/images', async (req, res) => {
    try {
        // Récupérer toutes les images de la base de données
        const query = 'SELECT id, original_name, watermarked_name, metadata, image_data FROM images';
        const result = await pool.query(query);

        // Convertir les images binaires en base64 pour les afficher
        const images = result.rows.map(row => ({
            id: row.id,
            original_name: row.original_name,
            watermarked_name: row.watermarked_name,
            metadata: row.metadata,
            image_data: row.image_data.toString('base64') // Convertir en base64
        }));

        res.status(200).send({
            message: 'Images récupérées avec succès !',
            images: images
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des images :', error);
        res.status(500).send('Erreur interne du serveur.');
    }
});

app.get('/export', (req, res) => {
    const imagePath = req.query.path;
    const format = req.query.format || 'png';

    if (!fs.existsSync(imagePath)) {
        return res.status(404).send('Fichier non trouvé.');
    }

    sharp(imagePath)
        .toFormat(format)
        .toBuffer()
        .then(data => {
            res.set('Content-Type', `image/${format}`);
            res.send(data);
        })
        .catch(error => {
            console.error('Erreur lors de l\'exportation :', error);
            res.status(500).send('Erreur interne du serveur.');
        });
});
app.delete('/images/:id', async (req, res) => {
    const imageId = req.params.id;

    try {
        // Vérifier si l'image existe
        const checkQuery = 'SELECT * FROM images WHERE id = $1';
        const checkResult = await pool.query(checkQuery, [imageId]);

        if (checkResult.rows.length === 0) {
            return res.status(404).send('Image non trouvée.');
        }

        // Supprimer l'image de la base de données
        const deleteQuery = 'DELETE FROM images WHERE id = $1';
        await pool.query(deleteQuery, [imageId]);

        res.status(200).send({ message: 'Image supprimée avec succès !' });
    } catch (error) {
        console.error('Erreur lors de la suppression de l\'image :', error);
        res.status(500).send('Erreur interne du serveur.');
    }
});

// Démarrer le serveur
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Serveur k_relle en écoute sur http://localhost:${PORT}`);
});