import express from "express";
import { PrismaClient } from "@prisma/client";
import { GoogleGenAI, Type } from "@google/genai";
import auth from "../middleware/auth.js"; // Updated import to default
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const prisma = new PrismaClient();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Updated route to use auth middleware
router.post("/create", auth, async (req, res) => {
  try {
    const userId = req.user?.userId; // Updated to match auth middleware's user object

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { topic, level, numberOfQuestions, timeLimit } = req.body;

    if (!topic || !level || numberOfQuestions === undefined || timeLimit === undefined) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields (topic, level, numberOfQuestions, timeLimit)",
      });
    }

    // Validate level
    const validDifficulties = ["beginner", "intermediate", "expert"];

    if (!validDifficulties.includes(level.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid level. Must be one of: ${validDifficulties.join(
          ", "
        )}`,}
      );
    }

    // Validate number of questions and time limit
    if (typeof numberOfQuestions !== "number" || numberOfQuestions <= 0) {
      return res.status(400).json({
        success: false,
        message: "Number of questions must be a positive number",
      });
    }

    if (typeof timeLimit !== "number" || timeLimit < 0) {
      return res.status(400).json({
        success: false,
        message: "Time limit must be a non-negative number",
      });
    }

    // Construct the prompt for Gemini (using logic from quiz.js)
    const prompt = `Generate a quiz about "${topic}" for a ${level} level. The quiz should have ${numberOfQuestions} questions and be designed to be completed within ${timeLimit} minutes. For each question, provide the question text, exactly four options (labeled A, B, C, D), and the correct answer. Format the output as a JSON object matching the following schema:`;

    // Define the response schema for Gemini (using logic from quiz.js)
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        quizTitle: {
          type: Type.STRING,
          description: `A title for the quiz about ${topic}`,
        },
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              questionText: {
                type: Type.STRING,
                description: "The text of the quiz question.",
              },
              options: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING,
                  description:
                    "An option for the question (e.g., 'A. Option text'). There should be exactly four options.",
                },
                description:
                  "An array containing exactly four answer options for the question.",
              },
              correctAnswer: {
                type: Type.NUMBER,
                description: "The correct answer option index (e.g., 0,1,2,3).",
              },
            },
            required: ["questionText", "options", "correctAnswer"],
            description:
              "A single quiz question with options and the correct answer.",
          },
          description: `An array of ${numberOfQuestions} quiz questions.`,
        },
      },
      required: ["quizTitle", "questions"],
      description: `A JSON object representing a quiz about ${topic}.`,
    };

    // Call the Gemini API (using logic from quiz.js)
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash", // Using a suitable model
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
    });

    // Parse the JSON response from Gemini (using logic from quiz.js)
    const responseText = response.text;
    let quizData; // Type annotation removed

    try {
      // Gemini's response.text might contain markdown code block, so we need to parse it
      const jsonMatch = responseText?.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch && jsonMatch[1]) {
        quizData = JSON.parse(jsonMatch[1]);
      } else {
        // If no markdown block, try parsing directly (less common for structured output)
        quizData = JSON.parse(responseText || "");
      }

      // Basic validation of the parsed data structure
      if (
        !quizData ||
        !Array.isArray(quizData.questions) ||
        quizData.questions.length === 0
      ) {
        throw new Error("Invalid quiz data structure received from AI.");
      }
    } catch (parseError) {
      console.error("Failed to parse Gemini response:", parseError);
      console.error("Raw Gemini response text:", responseText);
      return res.status(500).json({
        success: false,
        message: "Failed to parse AI response.",
        error: parseError.message, // Type assertion removed
      });
    }

    // Create the quiz with nested relations (using logic from quiz.js)
    const createdQuiz = await prisma.quiz.create({
      data: {
        title: quizData.quizTitle,
        description: `A ${level} level quiz about ${topic}`,
        timeLimit: timeLimit,
        isPublic: true, // Assuming quizzes created via this route are public
        authorId: userId || 0, // Link quiz to the creating user
        topic: topic,
        questions: {
          create: quizData.questions.map((q) => ({
            text: q.questionText,
            options: {
              create: q.options.map((opt, index) => ({
                text: opt,
                isCorrect: index === q.correctAnswer,
              })),
            },
          })),
        },
      },
      include: {
        questions: {
          include: {
            options: true,
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: "Quiz created successfully",
      quiz: createdQuiz,
    });
  } catch (error) {
    console.error("Error creating quiz:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error during quiz creation" });
  }
});

// GET route to fetch quizzes (public or by user)
router.get("/", async (req, res) => {
  try {
    const { isPublic, q, id } = req.query;
    const userId = req.user?.userId; // Get user ID from auth middleware if available

    let whereClause = {};

    if (id) {
      // Fetch a single quiz by ID
      whereClause = { id: +id };
    } else if (isPublic === "true") {
      // Fetch only public quizzes
      whereClause = { isPublic: true };
    } else if (userId) {
      // Fetch quizzes owned by the authenticated user
      whereClause = { userId: userId };
    } else {
      // If no user is authenticated and isPublic is not true, return only public quizzes
      whereClause = { isPublic: true };
    }

    if (q) {
      // Add search filter if query parameter 'q' is present
      whereClause.title = {
        contains: q, // Case-insensitive search
        mode: "insensitive", // Use insensitive mode for PostgreSQL
      };
    }

    const quizzes = await prisma.quiz.findMany({
      where: whereClause,
      include: { questions: true }, // Include nested questions and options
    });

    res.status(200).json({
      success: true,
      count: quizzes.length,
      data: quizzes,
    });
  } catch (error) {
    console.error("Error fetching quizzes:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching quizzes" });
  } finally {
    await prisma.$disconnect();
  }
});

export default router;
