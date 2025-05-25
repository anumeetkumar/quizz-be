    import express from 'express';
    import bcrypt from 'bcryptjs';
    import jwt from 'jsonwebtoken';
    import { PrismaClient } from '@prisma/client';

    const router = express.Router();
    const prisma = new PrismaClient();

    // Register route
    router.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
        return res.status(400).json({
            success: false,
            message: 'All fields are required',
        });
        }

        const existingUser = await prisma.user.findUnique({
        where: { email },
        });

        if (existingUser) {
        return res.status(400).json({
            success: false,
            message: 'User already exists',
        });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
        data: {
            email,
            password: hashedPassword,
            name,
        },
        });

        const { password: _, ...userWithoutPassword } = user;

        return res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: userWithoutPassword,
        });
    } catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({
        success: false,
        message: 'Internal server error',
        });
    }
    });

    // Login route
    router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
        return res.status(400).json({
            success: false,
            message: 'Email and password are required',
        });
        }

        const user = await prisma.user.findUnique({
        where: { email },
        });

        if (!user) {
        return res.status(401).json({
            success: false,
            message: 'Invalid credentials',
        });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);

        if (!isValidPassword) {
        return res.status(401).json({
            success: false,
            message: 'Invalid credentials',
        });
        }

        const token = jwt.sign(
        { userId: user.id },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '1d' }
        );

        const { password: _, ...userWithoutPassword } = user;

        return res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
            user: userWithoutPassword,
            token,
        },
        });
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({
        success: false,
        message: 'Internal server error',
        });
    }
    });

    export default router;