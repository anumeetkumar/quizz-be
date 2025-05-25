const { GoogleGenAI, Type } = require("@google/genai");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Define the API response type (TypeScript interfaces are removed in JS)
// interface CreateQuizRequest extends Record<string, unknown> {
//   topic: string;
//   level: "beginner" | "intermediate" | "expert";
//   timeLimit: number; // in minutes
//   numberOfQuestions: number;
// }

// interface QuizQuestion {
//   questionText: string;
//   options: string[];
//   correctAnswer: number;
// }

// interface QuizResponseData {
//   quizTitle: string;
//   questions: QuizQuestion[];
// }

// Define the API response type (TypeScript types are removed in JS)
// type CreateQuizResponse = {
//   success: boolean;
//   message: string;
//   data?: Quiz;
//   error?: string;
// };

// Remove the default export from the handler function
async function handler(
  req, // AuthenticatedRequest type removed
  res // NextApiResponse<CreateQuizResponse> type removed
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed",
    });
  }

  try {
    const userId = req.user?.id;
    const { topic, level, timeLimit, numberOfQuestions } =
      req.body; // Type assertion removed

    // Validate required fields
    if (
      !topic ||
      !level ||
      timeLimit === undefined ||
      numberOfQuestions === undefined
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required parameters (topic, level, timeLimit, numberOfQuestions)",
      });
    }

    // Construct the prompt for Gemini
    const prompt = `Generate a quiz about "${topic}" for a ${level} level. The quiz should have ${numberOfQuestions} questions and be designed to be completed within ${timeLimit} minutes. For each question, provide the question text, exactly four options (labeled A, B, C, D), and the correct answer. Format the output as a JSON object matching the following schema:`;

    // Define the response schema for Gemini
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

    // Call the Gemini API
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash", // Using a suitable model
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
    });

    // Parse the JSON response from Gemini
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

    // Create the quiz with nested relations
    const quiz = await prisma.quiz.create({
      data: {
        title: quizData.quizTitle,
        description: `A ${level} level quiz about ${topic}`,
        timeLimit: timeLimit,
        isPublic: true,
        authorId: userId || 0,
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

    return res.status(200).json({
      success: true,
      message: "Quiz generated and saved successfully",
      data: quiz,
    });
  } catch (error) {
    console.error("Create quiz error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create quiz",
      error: error.message, // Type assertion removed
    });
  }
}

// If you need to export the handler for use in a framework like Next.js, you would add:
// export default handler;