"""
FastAPI backend with Ollama integration for SimplifiED
Processes lecture transcriptions using local Ollama LLM
"""

from fastapi import FastAPI, HTTPException, File, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime
import os
from dotenv import load_dotenv
import requests
import time
import json
import base64
from io import BytesIO
from PIL import Image, ImageEnhance, ImageFilter

# Load environment variables
load_dotenv()

# Initialize FastAPI
app = FastAPI(title="SimplifiED Backend")

# Configure CORS - Allow frontend origins (including all Vercel deployments)
# Vercel creates multiple URLs: production + preview deployments
# Using regex pattern to allow all Vercel domains
import re

allowed_origin_patterns = [
    r"http://localhost:\d+",  # Local development
    r"https://.*\.vercel\.app",  # All Vercel deployments
    r"https://.*-pushkarrds-projects\.vercel\.app",  # Your Vercel account
]

def is_allowed_origin(origin: str) -> bool:
    """Check if origin matches allowed patterns"""
    if not origin:
        return False
    for pattern in allowed_origin_patterns:
        if re.match(pattern, origin):
            return True
    return False

# Custom CORS handler
@app.middleware("http")
async def cors_handler(request: Request, call_next):
    origin = request.headers.get("origin", "")
    
    response = await call_next(request)
    
    # Add CORS headers if origin is allowed
    if is_allowed_origin(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
    
    return response

# Handle preflight requests
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*\.vercel\.app|http://localhost:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Firebase Admin SDK
cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

# Pydantic models
class LectureCreate(BaseModel):
    userId: str
    transcription: str

class LectureUpdate(BaseModel):
    transcription: str = None
    simpleText: str = None
    detailedSteps: str = None
    mindMap: str = None
    summary: str = None

# Google Gemini API Configuration (native REST API)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")  # Gemini API key
GEMINI_MODEL = "gemini-2.5-flash"  # Gemini model for text and vision
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

@app.get("/")
async def root():
    return {"message": "SimplifiED Backend with Gemini AI", "status": "running"}

@app.get("/health")
async def health_check():
    return {"status": "ok", "model": GEMINI_MODEL}

def chunk_text(text: str, max_chunk_size: int = 500) -> list:
    """Split text into smaller chunks for faster processing"""
    sentences = text.replace("?", ".").replace("!", ".").split(".")
    sentences = [s.strip() for s in sentences if s.strip()]
    
    chunks = []
    current_chunk = []
    current_length = 0
    
    for sentence in sentences:
        sentence_length = len(sentence)
        if current_length + sentence_length > max_chunk_size and current_chunk:
            chunks.append(". ".join(current_chunk) + ".")
            current_chunk = [sentence]
            current_length = sentence_length
        else:
            current_chunk.append(sentence)
            current_length += sentence_length
    
    if current_chunk:
        chunks.append(". ".join(current_chunk) + ".")
    
    return chunks

def generate_with_gemini(prompt: str, system: str = None, stream: bool = False) -> str:
    """Generate text using Google Gemini native REST API with retry for rate limits"""
    url = f"{GEMINI_API_BASE}/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    
    # Build contents array
    if system:
        prompt = f"{system}\n\n{prompt}"
    
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 1500
        }
    }
    
    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=60)
            
            if response.status_code == 429:
                wait_time = (2 ** attempt) * 2  # 2s, 4s, 8s
                print(f"⏳ Rate limited (attempt {attempt+1}/{max_retries}), waiting {wait_time}s...")
                time.sleep(wait_time)
                continue
            
            if response.status_code != 200:
                print(f"❌ Gemini API Error {response.status_code}: {response.text}")
                raise HTTPException(status_code=500, detail=f"Gemini API error: {response.text}")
            
            data = response.json()
            return data['candidates'][0]['content']['parts'][0]['text']
            
        except requests.exceptions.RequestException as e:
            print(f"Gemini API error: {e}")
            if attempt < max_retries - 1:
                time.sleep(2)
                continue
            raise HTTPException(status_code=500, detail=f"Gemini processing failed: {str(e)}")
    
    raise HTTPException(status_code=429, detail="Gemini API rate limit exceeded. Please wait a moment and try again.")

@app.post("/api/lectures")
async def create_lecture(lecture: LectureCreate):
    """Create a new lecture with transcription"""
    try:
        lecture_data = {
            "userId": lecture.userId,
            "transcription": lecture.transcription,
            "simpleText": "",
            "detailedSteps": "",
            "mindMap": "",
            "summary": "",
            "createdAt": datetime.now(),
            "updatedAt": datetime.now()
        }
        
        doc_ref = db.collection("lectures").document()
        doc_ref.set(lecture_data)
        
        return {"id": doc_ref.id, **lecture_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/lectures/{lecture_id}")
async def get_lecture(lecture_id: str):
    """Get a specific lecture"""
    try:
        doc = db.collection("lectures").document(lecture_id).get()
        if not doc.exists:
            raise HTTPException(status_code=404, detail="Lecture not found")
        
        data = doc.to_dict()
        return {"id": doc.id, **data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/lectures/user/{user_id}/latest")
async def get_latest_lecture(user_id: str):
    """Get the latest lecture for a user"""
    try:
        docs = db.collection("lectures")\
            .where("userId", "==", user_id)\
            .order_by("createdAt", direction=firestore.Query.DESCENDING)\
            .limit(1)\
            .stream()
        
        for doc in docs:
            data = doc.to_dict()
            return {"id": doc.id, **data}
        
        raise HTTPException(status_code=404, detail="No lectures found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/lectures/{lecture_id}/process")
async def process_lecture(lecture_id: str):
    """Process lecture transcription through Gemini AI with chunking for faster processing"""
    try:
        # Get the lecture
        doc = db.collection("lectures").document(lecture_id).get()
        if not doc.exists:
            raise HTTPException(status_code=404, detail="Lecture not found")
        
        data = doc.to_dict()
        transcription = data.get("transcription", "")
        
        if not transcription:
            raise HTTPException(status_code=400, detail="No transcription to process")
        
        print(f"🚀 Processing lecture {lecture_id}...")
        start_time = time.time()
        
        # Chunk the transcription for faster processing
        chunks = chunk_text(transcription, max_chunk_size=600)
        print(f"📊 Split into {len(chunks)} chunks for processing")
        
        from concurrent.futures import ThreadPoolExecutor
        
        # ⚡ OPTIMIZED PROMPTS - SHORTER = FASTER
        breakdown_prompt = f"""Break down by splitting words into syllables with hyphens. Keep sentences intact.

Example: "Photosynthesis is the process" → "Pho-to-syn-the-sis is the pro-cess"

Text to process:
{transcription}

Output only the syllable breakdown, no explanations:"""
        
        steps_prompt = f"""Break this lecture into clear, numbered steps (max 5-7 steps). Each step should be concise and actionable.

Text:
{transcription}

Output only the numbered steps, no extra text:"""
        
        mindmap_prompt = f"""Create a brief mind map with main topic and 3-4 key points only.

Text:
{transcription}

Format:
Main Topic
├─ Point 1
├─ Point 2
└─ Point 3

Keep it short:"""
        
        summary_prompt = f"""Summarize in 2-3 sentences: main topic, key points, and conclusion.

Text:
{transcription}

Summary:"""
        
        print("⚙️ Starting parallel processing of 4 outputs...")
        
        # Use ThreadPoolExecutor for parallel processing (simpler, no asyncio issues)
        with ThreadPoolExecutor(max_workers=4) as executor:
            breakdown_future = executor.submit(
                generate_with_gemini, 
                breakdown_prompt,
                "Break words into syllables. Output only the result."
            )
            steps_future = executor.submit(
                generate_with_gemini,
                steps_prompt,
                "Create numbered steps. Be concise."
            )
            mindmap_future = executor.submit(
                generate_with_gemini,
                mindmap_prompt,
                "Create a brief mind map. Keep it very short."
            )
            summary_future = executor.submit(
                generate_with_gemini,
                summary_prompt,
                "Write a 2-3 sentence summary."
            )
            
            # Wait for all to complete
            breakdown_text = breakdown_future.result()
            detailed_steps = steps_future.result()
            mind_map = mindmap_future.result()
            summary = summary_future.result()
        
        elapsed_time = time.time() - start_time
        print(f"✅ Processing complete in {elapsed_time:.1f} seconds!")
        
        # Update Firestore
        update_data = {
            "simpleText": breakdown_text,
            "detailedSteps": detailed_steps,
            "mindMap": mind_map,
            "summary": summary,
            "updatedAt": datetime.now(),
            "processingTime": elapsed_time
        }
        
        db.collection("lectures").document(lecture_id).update(update_data)
        
        print("Done! Saved to Firestore.")
        return {
            "id": lecture_id,
            "simpleText": breakdown_text,
            "detailedSteps": detailed_steps,
            "mindMap": mind_map,
            "summary": summary,
            "processingTime": elapsed_time
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error processing lecture: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/lectures/{lecture_id}")
async def update_lecture(lecture_id: str, updates: LectureUpdate):
    """Update lecture fields"""
    try:
        update_data = {k: v for k, v in updates.dict().items() if v is not None}
        update_data["updatedAt"] = datetime.now()
        
        db.collection("lectures").document(lecture_id).update(update_data)
        
        doc = db.collection("lectures").document(lecture_id).get()
        data = doc.to_dict()
        return {"id": doc.id, **data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/lectures/{lecture_id}")
async def delete_lecture(lecture_id: str):
    """Delete a lecture"""
    try:
        db.collection("lectures").document(lecture_id).delete()
        return {"message": "Lecture deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/lectures/user/{user_id}")
async def get_user_lectures(user_id: str):
    """Get all lectures for a user"""
    try:
        docs = db.collection("lectures")\
            .where("userId", "==", user_id)\
            .order_by("createdAt", direction=firestore.Query.DESCENDING)\
            .stream()
        
        lectures = []
        for doc in docs:
            data = doc.to_dict()
            lectures.append({"id": doc.id, **data})
        
        return lectures
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/transcribe-audio")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Transcribe audio file using AssemblyAI
    Requires ASSEMBLYAI_API_KEY in environment variables
    """
    try:
        # Get API key from environment
        api_key = os.getenv("ASSEMBLYAI_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=500, 
                detail="AssemblyAI API key not configured. Please add ASSEMBLYAI_API_KEY to .env file."
            )
        
        # Read file content
        file_content = await file.read()
        
        # Upload audio to AssemblyAI
        headers = {"authorization": api_key}
        upload_response = requests.post(
            "https://api.assemblyai.com/v2/upload",
            headers=headers,
            data=file_content
        )
        
        if upload_response.status_code != 200:
            raise HTTPException(status_code=500, detail="Failed to upload audio file")
        
        audio_url = upload_response.json()["upload_url"]
        
        # Request transcription
        transcript_request = {
            "audio_url": audio_url,
            "language_code": "en"
        }
        
        transcript_response = requests.post(
            "https://api.assemblyai.com/v2/transcript",
            headers=headers,
            json=transcript_request
        )
        
        if transcript_response.status_code != 200:
            raise HTTPException(status_code=500, detail="Failed to request transcription")
        
        transcript_id = transcript_response.json()["id"]
        
        # Poll for transcription completion
        polling_endpoint = f"https://api.assemblyai.com/v2/transcript/{transcript_id}"
        max_attempts = 60  # 5 minutes max
        attempt = 0
        
        while attempt < max_attempts:
            polling_response = requests.get(polling_endpoint, headers=headers)
            transcription_result = polling_response.json()
            
            if transcription_result["status"] == "completed":
                return {
                    "transcription": transcription_result["text"],
                    "confidence": transcription_result.get("confidence", 0),
                    "words": len(transcription_result["text"].split())
                }
            elif transcription_result["status"] == "error":
                raise HTTPException(
                    status_code=500, 
                    detail=f"Transcription failed: {transcription_result.get('error', 'Unknown error')}"
                )
            
            # Wait before polling again
            time.sleep(5)
            attempt += 1
        
        raise HTTPException(status_code=408, detail="Transcription timeout. Please try again.")
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Transcription error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


# ============================================
# NEW ENDPOINTS: Handwriting, Content, Analytics
# ============================================

import base64

class ContentTransformRequest(BaseModel):
    text: str
    userId: str = "anonymous"

class RecommendationRequest(BaseModel):
    userId: str
    readingSessions: int = 0
    avgQuizScore: float = 0
    handwritingErrors: int = 0


@app.post("/api/handwriting/analyze")
async def analyze_handwriting(file: UploadFile = File(...), userId: str = "anonymous"):
    """
    Analyze handwriting image for dyslexia-related errors using Gemini Vision AI.
    Returns detailed scoring, extracted text, error highlights, and improvement tips.
    """
    try:
        file_content = await file.read()
        
        # Validate file size (50 MB limit)
        if len(file_content) > 50 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File size exceeds 50 MB limit.")
        
        base64_image = base64.b64encode(file_content).decode('utf-8')
        
        # Determine mime type
        mime_type = file.content_type or 'image/jpeg'
        
        url = f"{GEMINI_API_BASE}/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
        headers = {"Content-Type": "application/json"}
        
        system_prompt = """You are a dyslexia handwriting analyst. Analyze the handwriting image and respond with ONLY a JSON object (no markdown, no code fences, no extra text).

Instructions:
1. Extract all text from the image as "extractedText" (keep it concise — max 300 chars, truncate with ... if longer)
2. Score each category 0-100 independently (vary scores based on actual quality):
   - letterFormation: letter shapes, b/d p/q reversals
   - spacing: letter/word/line spacing consistency
   - alignment: baseline, slant uniformity
   - spelling: correct spelling (flag every error)
   - sizing: letter size consistency
   - legibility: overall readability
3. Overall score = weighted avg: letterFormation 25%, spacing 15%, alignment 15%, spelling 25%, sizing 10%, legibility 10%
4. List errors (max 8 most important) and spelling errors (max 10)
5. Keep all descriptions SHORT (under 50 chars each)

JSON format — output ONLY this, nothing else:
{"score":N,"extractedText":"...","summary":"...","categoryScores":{"letterFormation":N,"spacing":N,"alignment":N,"spelling":N,"sizing":N,"legibility":N},"errors":[{"type":"...","severity":"high|medium|low","word":"...","correction":"...","description":"...","suggestion":"..."}],"spellingErrors":[{"wrong":"...","correct":"...","type":"misspelling|abbreviation|missing_letter|extra_letter|transposition"}],"strengths":["..."],"recommendations":[{"title":"...","description":"...","priority":"high|medium|low"}]}"""

        user_prompt = """Analyze this handwriting. Extract text, score each category independently (NOT same scores), find errors. Keep descriptions SHORT. Output ONLY valid JSON, no markdown fences."""

        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": f"{system_prompt}\n\n{user_prompt}"},
                        {
                            "inlineData": {
                                "mimeType": mime_type,
                                "data": base64_image
                            }
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 8192,
                "responseMimeType": "application/json"
            }
        }
        
        # Retry with backoff for rate limits
        result_text = None
        max_retries = 3
        for attempt in range(max_retries):
            response = requests.post(url, headers=headers, json=payload, timeout=90)
            
            if response.status_code == 429:
                wait_time = (2 ** attempt) * 2
                print(f"⏳ Vision rate limited (attempt {attempt+1}/{max_retries}), waiting {wait_time}s...")
                time.sleep(wait_time)
                continue
            
            if response.status_code != 200:
                print(f"Gemini Vision API Error: {response.status_code} - {response.text}")
                raise HTTPException(status_code=500, detail=f"Vision API error: {response.text}")
            
            result_text = response.json()['candidates'][0]['content']['parts'][0]['text']
            break
        
        if result_text is None:
            raise HTTPException(status_code=429, detail="Rate limit exceeded. Please wait a moment and try again.")
        
        # Parse the JSON response
        try:
            # Strip markdown code fences if present (```json ... ``` or ``` ... ```)
            cleaned = result_text.strip()
            if cleaned.startswith("```"):
                # Remove opening fence (```json or ```)
                first_newline = cleaned.index('\n')
                cleaned = cleaned[first_newline + 1:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
            
            # Try to extract JSON from the cleaned response
            json_start = cleaned.find('{')
            json_end = cleaned.rfind('}') + 1
            if json_start >= 0 and json_end > json_start:
                json_str = cleaned[json_start:json_end]
            else:
                json_str = cleaned
            
            print(f"📝 Parsing JSON response ({len(json_str)} chars)...")
            result = json.loads(json_str)
            print(f"✅ Parsed successfully. Score from AI: {result.get('score', 'N/A')}")
            
            # Use AI's category scores directly — do NOT override with defaults
            if "categoryScores" in result and isinstance(result["categoryScores"], dict):
                cats = result["categoryScores"]
                # Recompute the overall score from category scores for consistency
                weights = {
                    "letterFormation": 0.25, "spacing": 0.15, "alignment": 0.15,
                    "spelling": 0.25, "sizing": 0.10, "legibility": 0.10
                }
                computed_score = sum(cats.get(k, cats.get(k, 50)) * w for k, w in weights.items())
                result["score"] = round(computed_score)
                print(f"📊 Category scores: {cats}")
                print(f"📊 Computed weighted score: {result['score']}")
            
            # Only fill truly missing fields — do NOT overwrite AI-provided values
            result.setdefault("extractedText", "")
            result.setdefault("summary", "Analysis complete.")
            if "categoryScores" not in result:
                # Only use defaults if AI completely failed to provide category scores
                result["categoryScores"] = {
                    "letterFormation": result.get("score", 50),
                    "spacing": result.get("score", 50),
                    "alignment": result.get("score", 50),
                    "spelling": result.get("score", 50),
                    "sizing": result.get("score", 50),
                    "legibility": result.get("score", 50),
                }
            result.setdefault("errors", [])
            result.setdefault("spellingErrors", [])
            result.setdefault("strengths", [])
            result.setdefault("recommendations", [])
            
        except (json.JSONDecodeError, ValueError) as parse_err:
            print(f"❌ JSON parse failed: {parse_err}")
            print(f"❌ Raw response (first 500 chars): {result_text[:500]}")
            
            # Last resort: try a more aggressive cleanup
            try:
                import re as regex_module
                # Find anything that looks like a JSON object
                json_match = regex_module.search(r'\{[\s\S]*\}', result_text)
                if json_match:
                    fallback_json = json_match.group()
                    # Remove any control characters
                    fallback_json = regex_module.sub(r'[\x00-\x1f\x7f-\x9f]', ' ', fallback_json)
                    result = json.loads(fallback_json)
                    print(f"✅ Recovered JSON on second attempt. Score: {result.get('score', 'N/A')}")
                    result.setdefault("extractedText", "")
                    result.setdefault("summary", "Analysis complete.")
                    result.setdefault("categoryScores", {})
                    result.setdefault("errors", [])
                    result.setdefault("spellingErrors", [])
                    result.setdefault("strengths", [])
                    result.setdefault("recommendations", [])
                else:
                    raise ValueError("No JSON object found in response")
            except Exception:
                # True fallback — but use extractedText from raw if possible
                result = {
                    "score": 0,
                    "extractedText": "",
                    "summary": "Analysis could not parse the AI response. Please try again with a clearer image.",
                    "categoryScores": {
                        "letterFormation": 0, "spacing": 0, "alignment": 0,
                        "spelling": 0, "sizing": 0, "legibility": 0
                    },
                    "errors": [{
                        "type": "Parse Error",
                        "severity": "high",
                        "word": "",
                        "correction": "",
                        "description": "The AI response could not be parsed. This usually means the image was unclear or the AI returned an unexpected format.",
                        "suggestion": "Try uploading a clearer, well-lit photo of the handwriting."
                    }],
                    "spellingErrors": [],
                    "strengths": [],
                    "recommendations": [
                        {"title": "Try again", "description": "Upload a clearer photo with good lighting and contrast.", "priority": "high"}
                    ]
                }
        
        # Save to Firestore
        try:
            db.collection("handwritingUploads").add({
                "userId": userId,
                "score": result.get("score", 0),
                "errorCount": len(result.get("errors", [])),
                "errors": result.get("errors", []),
                "createdAt": datetime.now()
            })
        except Exception as save_err:
            print(f"Failed to save handwriting result: {save_err}")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Handwriting analysis error: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@app.post("/api/content/transform")
async def transform_content(request: ContentTransformRequest):
    """
    Transform educational content into multiple learning formats:
    simplified notes, flashcards, quiz, mind map
    """
    try:
        text = request.text
        if not text.strip():
            raise HTTPException(status_code=400, detail="No text provided")
        
        print(f"🔄 Transforming content ({len(text)} chars)...")
        start_time = time.time()
        
        from concurrent.futures import ThreadPoolExecutor
        
        notes_prompt = f"""Simplify this educational content for a student with dyslexia. Use:
- Short, clear sentences
- Simple vocabulary
- Bullet points for key facts
- Bold key terms

Text:
{text}

Simplified notes:"""
        
        flashcard_prompt = f"""Create 5-8 flashcards from this content. Format EXACTLY as:
Q: [question]
A: [answer]

Q: [question]
A: [answer]

Text:
{text}

Flashcards:"""
        
        quiz_prompt = f"""Create a 5-question multiple choice quiz from this content. Format EXACTLY as:

1. [Question text]
A. [Option]
B. [Option]
C. [Option] (correct)
D. [Option]

Mark the correct answer with (correct). 

Text:
{text}

Quiz:"""
        
        mindmap_prompt = f"""Create a text-based mind map from this content. Format as:

Main Topic Name
├─ Category 1
│  ├─ Detail 1a
│  └─ Detail 1b
├─ Category 2
│  ├─ Detail 2a
│  └─ Detail 2b
└─ Category 3
   ├─ Detail 3a
   └─ Detail 3b

Text:
{text}

Mind Map:"""
        
        with ThreadPoolExecutor(max_workers=4) as executor:
            notes_future = executor.submit(generate_with_gemini, notes_prompt, "Simplify content for dyslexic learners. Be clear and concise.")
            flashcard_future = executor.submit(generate_with_gemini, flashcard_prompt, "Create flashcards. Use Q: and A: format strictly.")
            quiz_future = executor.submit(generate_with_gemini, quiz_prompt, "Create a quiz. Mark correct answers with (correct).")
            mindmap_future = executor.submit(generate_with_gemini, mindmap_prompt, "Create a text mind map using tree characters.")
            
            simplified_notes = notes_future.result()
            flashcards = flashcard_future.result()
            quiz = quiz_future.result()
            mind_map = mindmap_future.result()
        
        elapsed = time.time() - start_time
        print(f"✅ Content transformation complete in {elapsed:.1f}s")
        
        return {
            "simplifiedNotes": simplified_notes,
            "flashcards": flashcards,
            "quiz": quiz,
            "mindMap": mind_map,
            "processingTime": elapsed
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Content transformation error: {e}")
        raise HTTPException(status_code=500, detail=f"Transformation failed: {str(e)}")


@app.post("/api/analytics/recommend")
async def get_recommendations(request: RecommendationRequest):
    """Generate AI-powered learning recommendations based on user stats"""
    try:
        prompt = f"""Based on these learning statistics for a dyslexic student, provide 4-5 personalized practice recommendations:

- Reading sessions completed: {request.readingSessions}
- Average quiz score: {request.avgQuizScore}%
- Handwriting errors detected: {request.handwritingErrors}

Provide specific, actionable recommendations. Format as a JSON array:
[
  {{"title": "...", "description": "...", "priority": "high|medium|low"}}
]"""
        
        result = generate_with_gemini(prompt, "You are an educational psychologist specializing in dyslexia. Provide practical learning recommendations. Respond with valid JSON only.")
        
        try:
            json_start = result.find('[')
            json_end = result.rfind(']') + 1
            recommendations = json.loads(result[json_start:json_end])
        except:
            recommendations = [
                {"title": "Practice daily reading", "description": "Spend 15-20 minutes reading with the Reading Assistant.", "priority": "high"},
                {"title": "Review weak areas", "description": "Focus on topics where quiz scores are lowest.", "priority": "medium"},
            ]
        
        return {"recommendations": recommendations}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Recommendation failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

