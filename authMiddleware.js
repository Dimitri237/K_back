const jwt = require('jsonwebtoken');
const secretKey = '77181753';

const authenticateToken = (req, res, next) => {
    const token = req.header('Authorization')?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Missing token' });
    }

    jwt.verify(token, secretKey, (err, decoded) => {
        if (err) {
            return res.status(401).json({ message: 'Invalid token' });
        }

        req.user = decoded.username;
        next();
    });
};

module.exports = authenticateToken;