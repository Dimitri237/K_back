const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const sharp = require('sharp');
const path = require('path');
const app = express();
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // Répertoire de destination
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname); // Renommer le fichier avec un timestamp
    }
});
const upload = multer({ storage: storage });
const exiftool = require('exiftool-vendored').exiftool;
// Middleware CORS
app.use(cors({ origin: 'http://localhost:8081', credentials: true }));
// Configuration de multer pour stocker les fichiers dans le répertoire 'uploads'

// Fonction pour ajouter des métadonnées à une image
async function insertMetadata(imagePath, metadata, outputPath) {
    try {
        // Vérifiez que le fichier existe
        if (!fs.existsSync(imagePath)) {
            console.error('Le fichier n\'existe pas :', imagePath);
            return;
        }

        // Créer un buffer EXIF
        const exifData = {
            IFD0: {
                UserComment: metadata,
            },
        };

        await sharp(imagePath)
            .withMetadata(exifData) // Ajoutez vos métadonnées ici
            .toFile(outputPath);

        console.log('Métadonnées insérées avec succès !');
    } catch (error) {
        console.error('Erreur lors de l\'insertion des métadonnées :', error);
    }
}
// Endpoint pour uploader une image
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

        res.status(200).send({ 
            message: 'Fichier uploadé et tatoué avec succès !', 
            original: filePath, 
            watermarked: outputPath,
            metadata: metadata
        });
    } catch (error) {
        console.error('Erreur lors du traitement du fichier :', error);
        res.status(500).send('Erreur interne du serveur.');
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
// Endpoint pour exporter une image tatouée
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

// Démarrer le serveur
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Serveur backend en écoute sur http://localhost:${PORT}`);
});