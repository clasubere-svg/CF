"""
ai_server.py — CampusFinds AI Matching Server
Run with: python ai_server.py
Requires: pip install flask flask-cors google-genai pillow supabase-py requests python-dotenv
"""

import os
import re
import json
import base64
import traceback
import time
from io import BytesIO
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import PIL.Image
from google import genai
from google.genai import types
from supabase import create_client, Client
import requests

# ═══════════════════════════════════════════════════════════
# LOAD ENVIRONMENT VARIABLES
# ═══════════════════════════════════════════════════════════

load_dotenv()  # Loads variables from .env file

# ═══════════════════════════════════════════════════════════
# CONFIGURATION — Loaded from .env file
# ═══════════════════════════════════════════════════════════

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

# Flask Configuration
FLASK_HOST = os.getenv("FLASK_HOST", "0.0.0.0")
FLASK_PORT = int(os.getenv("FLASK_PORT", "5000"))
FLASK_DEBUG = os.getenv("FLASK_DEBUG", "True").lower() == "true"

# ═══════════════════════════════════════════════════════════
# VALIDATE CONFIGURATION
# ═══════════════════════════════════════════════════════════

def validate_config():
    """Check if required environment variables are set"""
    missing = []
    if not GEMINI_API_KEY:
        missing.append("GEMINI_API_KEY")
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_SERVICE_KEY:
        missing.append("SUPABASE_SERVICE_KEY")
    
    if missing:
        print("️  WARNING: Missing environment variables:")
        for var in missing:
            print(f"   - {var}")
        print("\n Create a .env file with these variables or set them in your environment.")
        print("   See .env.example for template.\n")
    
    return len(missing) == 0

# ═══════════════════════════════════════════════════════════
# INITIALIZE
# ═══════════════════════════════════════════════════════════

app = Flask(__name__)
CORS(app, origins="*")

# Initialize clients only if keys are available
if GEMINI_API_KEY:
    gemini_client = genai.Client(
        api_key=GEMINI_API_KEY,
        http_options=types.HttpOptions(api_version='v1')
    )
else:
    gemini_client = None
    print("️  Gemini client not initialized - missing GEMINI_API_KEY")

if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
else:
    supabase = None
    print("️  Supabase client not initialized - missing credentials")

# ═══════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════

def load_image_from_url_or_base64(url_or_base64):
    try:
        if not url_or_base64:
            raise ValueError("Empty image URL provided")

        if url_or_base64.startswith('data:image'):
            if ',' in url_or_base64:
                base64_data = url_or_base64.split(',')[1]
            else:
                base64_data = url_or_base64
            image_bytes = base64.b64decode(base64_data)
            return PIL.Image.open(BytesIO(image_bytes))
        else:
            response = requests.get(url_or_base64, timeout=15)
            response.raise_for_status()
            return PIL.Image.open(BytesIO(response.content))

    except Exception as e:
        print(f"Error loading image: {e}")
        raise

    # ═══════════════════════════════════════════════════════════
# GEMINI CALL (UPDATED WITH 2 SECOND WAIT)
# ═══════════════════════════════════════════════════════════

def call_gemini(prompt, img1, img2):
    """
    Simple Gemini call with 2-second delay to avoid 503 errors
    """
    if not gemini_client:
        raise ValueError("Gemini client not initialized. Check GEMINI_API_KEY in .env file.")
    
    print("Calling gemini-2.5-flash-lite...")

    # WAIT 2 SECONDS TO REDUCE TRAFFIC
    time.sleep(2)

    response = gemini_client.models.generate_content(
        model='gemini-2.5-flash-lite',
        contents=[prompt, img1, img2]
    )
    
    return response.text

def parse_ai_response(text):
    """
    Parse Gemini response - NO RETRY VERSION
    """
    text_upper = text.upper()
    text_lower = text.lower()

    print(f"Parsing AI response: {text[:200]}...")

    # Check for negative/positive indicators
    negative_indicators = [
        'different items', 'not the same', 'not a match', 'no match',
        'completely different', 'entirely different', 'do not match',
        'are different', 'is different', 'not similar', 'no similarity',
        'distinct items', 'unrelated items', 'different objects'
    ]

    positive_indicators = [
        'same item', 'identical', 'match', 'similar', 'same object',
        'belong together', 'likely the same', 'probably the same',
        'appear to be the same', 'visual match'
    ]

    is_negative = any(indicator in text_lower for indicator in negative_indicators)
    is_positive = any(indicator in text_lower for indicator in positive_indicators)

    # Extract MATCH
    is_match = False
    match_yes_pattern = re.search(r'MATCH:\s*YES\b', text_upper)
    match_no_pattern = re.search(r'MATCH:\s*NO\b', text_upper)

    if match_yes_pattern:
        is_match = True
        print("Found MATCH: YES")
    elif match_no_pattern:
        is_match = False
        print("Found MATCH: NO")
    else:
        if is_negative and not is_positive:
            is_match = False
        elif is_positive and not is_negative:
            is_match = True
        else:
            is_match = False

    # Extract Confidence - % symbol optional
    raw_confidence = None

    # Pattern 1: "Confidence: 100" or "Confidence: 100%"
    conf_match = re.search(r'Confidence:\s*(\d+)\%?', text, re.IGNORECASE)
    if conf_match:
        raw_confidence = int(conf_match.group(1))

    # Pattern 2: "100 confidence" or "100% confidence"
    if raw_confidence is None:
        conf_match = re.search(r'(\d+)\%?\s*confidence', text, re.IGNORECASE)
        if conf_match:
            raw_confidence = int(conf_match.group(1))

    # Pattern 3: CONFIDENCE: 100
    if raw_confidence is None:
        conf_match = re.search(r'CONFIDENCE:\s*(\d+)', text_upper)
        if conf_match:
            raw_confidence = int(conf_match.group(1))

    # Default
    if raw_confidence is None:
        raw_confidence = 50

    # CRITICAL FIX: Invert confidence when MATCH is NO
    if is_match:
        display_confidence = raw_confidence
    else:
        display_confidence = 100 - raw_confidence

    display_confidence = max(0, min(100, display_confidence))

    # Extract Reason
    reason = text
    reason_match = re.search(r'(?i)REASON:\s*(.+?)(?=\n\n|$)', text, re.DOTALL)
    if reason_match:
        reason = reason_match.group(1).strip()
    else:
        for separator in ['REASON:', 'Reason:', 'reason:']:
            if separator in text:
                parts = text.split(separator)
                if len(parts) > 1:
                    reason = parts[-1].strip()
                    break
        else:
            reason = re.sub(r'(?i)match:\s*(yes|no)', '', reason)
            reason = re.sub(r'(?i)confidence:\s*\d+\%?', '', reason)
            reason = re.sub(r'(?i)confidence\s*\d+\%?', '', reason)
            reason = reason.strip()

    if len(reason) > 500:
        sentences = reason.split('.')
        reason = '.'.join(sentences[:4]) + '.'

    if not reason or len(reason.strip()) < 5:
        reason = "AI analysis completed. Items appear to be " + ("similar." if is_match else "different.")

    print(f"Final: match={is_match}, confidence={display_confidence}%")

    return {
        "match": is_match,
        "confidence": display_confidence,
        "reason": reason.strip(),
        "raw": text
    }

def call_gemini(prompt, img1, img2):
    """
    Simple Gemini call - NO RETRY, NO FALLBACK
    """
    if not gemini_client:
        raise ValueError("Gemini client not initialized. Check GEMINI_API_KEY in .env file.")
    
    print("Calling gemini-2.5-flash-lite...")
    
    response = gemini_client.models.generate_content(
        model='gemini-2.5-flash-lite',
        contents=[prompt, img1, img2]
    )
    
    return response.text

# ═══════════════════════════════════════════════════════════
# AI ANALYSIS FUNCTION
# ═══════════════════════════════════════════════════════════

def analyze_item_images(lost_url, found_url, lost_name, found_name, lost_desc="", found_desc=""):
    try:
        print(f"Analyzing: '{lost_name}' vs '{found_name}'")

        lost_img = load_image_from_url_or_base64(lost_url)
        found_img = load_image_from_url_or_base64(found_url)

        prompt = f"""You are an AI assistant for a school Lost & Found system.

Compare these two images and determine if they show the SAME physical item.

LOST ITEM: "{lost_name}"
Description: "{lost_desc}"

FOUND ITEM: "{found_name}"  
Description: "{found_desc}"

Analyze visual features: color, shape, size, brand logos, distinctive marks, wear patterns.

Respond EXACTLY in this format:
MATCH: YES or NO
CONFIDENCE: 0-100 (how sure are you on your decision its from 0 to 100 it can be 10, 40, or 73 etc...)
REASON: One sentence explanation

Only give high confidence (80-100) if you are very sure they are the exact same item.
"""

        text = call_gemini(prompt, lost_img, found_img)
        print(f"AI Response: {text[:300]}...")

        result = parse_ai_response(text)
        return result

    except Exception as e:
        print(f"Image analysis error: {e}")
        traceback.print_exc()
        return {
            "match": False,
            "confidence": 0,
            "reason": f"AI analysis failed: {str(e)}",
            "raw": str(e)
        }

# ═══════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "service": "CampusFinds AI",
        "gemini": "connected" if GEMINI_API_KEY else "missing_key",
        "supabase": "connected" if SUPABASE_URL else "missing_url"
    })

@app.route('/api/analyze-pair', methods=['POST'])
def analyze_pair():
    try:
        data = request.json

        result = analyze_item_images(
            data.get('lost_image_url'),
            data.get('found_image_url'),
            data.get('lost_item', 'Unknown'),
            data.get('found_item', 'Unknown'),
            data.get('lost_description', ''),
            data.get('found_description', '')
        )

        # Store in Supabase
        if supabase:
            try:
                record = {
                    "lost_item_id": data.get('lost_id'),
                    "found_item_id": data.get('found_id'),
                    "match_result": result["match"],
                    "confidence_score": result["confidence"],
                    "reason": result["reason"],
                    "analyzed_at": "now()"
                }
                supabase.table('ItemMatches').insert(record).execute()
            except Exception as e:
                print(f"DB store failed: {e}")

        return jsonify({
            "success": True,
            "analysis": result
        })

    except Exception as e:
        print(f"analyze_pair error: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/api/batch-analyze', methods=['POST'])
def batch_analyze():
    try:
        if not supabase:
            return jsonify({
                "success": False,
                "error": "Supabase not configured. Check SUPABASE_URL and SUPABASE_SERVICE_KEY in .env"
            }), 500

        lost_items = supabase.table('Report').select('*')\
            .eq('reporttype', 'lost')\
            .is_('is_claimed', 'null')\
            .neq('imageurl', None)\
            .execute()

        found_items = supabase.table('Report').select('*')\
            .eq('reporttype', 'found')\
            .is_('is_claimed', 'null')\
            .neq('imageurl', None)\
            .execute()

        lost_list = lost_items.data or []
        found_list = found_items.data or []

        print(f"Analyzing {len(lost_list)} lost x {len(found_list)} found items...")

        matches = []

        for lost in lost_list:
            for found in found_list:
                try:
                    existing = supabase.table('ItemMatches').select('id')\
                        .eq('lost_item_id', lost['id'])\
                        .eq('found_item_id', found['id'])\
                        .execute()

                    if existing.data:
                        continue
                except Exception as e:
                    print(f"Could not check existing match: {e}")

                result = analyze_item_images(
                    lost.get('imageurl'),
                    found.get('imageurl'),
                    lost.get('item', 'Unknown'),
                    found.get('item', 'Unknown'),
                    lost.get('description', ''),
                    found.get('description', '')
                )

                if result["confidence"] >= 60:
                    try:
                        record = {
                            "lost_item_id": lost['id'],
                            "found_item_id": found['id'],
                            "match_result": result["match"],
                            "confidence_score": result["confidence"],
                            "reason": result["reason"]
                        }
                        supabase.table('ItemMatches').insert(record).execute()

                        matches.append({
                            "lost": lost,
                            "found": found,
                            "confidence": result["confidence"],
                            "reason": result["reason"],
                            "match": result["match"]
                        })
                    except Exception as e:
                        print(f"Failed to store match: {e}")

        return jsonify({
            "success": True,
            "analyzed": len(lost_list) * len(found_list),
            "high_confidence_matches": len(matches),
            "matches": matches
        })

    except Exception as e:
        print(f"batch_analyze error: {e}")
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/api/matches', methods=['GET'])
def get_matches():
    try:
        if not supabase:
            return jsonify({
                "success": False,
                "error": "Supabase not configured"
            }), 500

        min_conf = request.args.get('min_confidence', 60, type=int)
        limit = request.args.get('limit', 50, type=int)

        result = supabase.table('ItemMatches').select(
            '*, lost:Report!lost_item_id(*, user:User!user_id(name,email)), found:Report!found_item_id(*, user:User!user_id(name,email))'
        )\
        .gte('confidence_score', min_conf)\
        .eq('match_result', True)\
        .order('confidence_score', desc=True)\
        .limit(limit)\
        .execute()

        return jsonify({
            "success": True,
            "matches": result.data or []
        })

    except Exception as e:
        print(f"get_matches error: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/api/compare-upload', methods=['POST'])
def compare_upload():
    try:
        data = request.json

        base64_string = data.get('uploaded_image', '')
        if not base64_string:
            return jsonify({
                "success": False,
                "error": "No uploaded image provided"
            }), 400

        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]

        image_bytes = base64.b64decode(base64_string)
        uploaded_img = PIL.Image.open(BytesIO(image_bytes))

        found_url = data.get('found_image_url')
        if not found_url:
            return jsonify({
                "success": False,
                "error": "No found image URL provided"
            }), 400

        found_img = load_image_from_url_or_base64(found_url)

        prompt = """Compare these two images for a school Lost and Found system.

Are they the same item? Analyze carefully.

Respond EXACTLY in this format:
MATCH: YES or NO
CONFIDENCE: 0-100 (how certain are you in your decision on it matching)
REASON: Brief explanation

IMPORTANT: If images show completely different objects (e.g., ball vs laptop, phone vs keys), tell how confident are you in that decision.
"""

        print(f"Analyzing: uploaded image vs {data.get('found_item_name')}...")

        text = call_gemini(prompt, uploaded_img, found_img)
        print(f"AI RESPONSE: {text}")

        result = parse_ai_response(text)

        print(f"Parsed: Match={result['match']}, Confidence={result['confidence']}%")

        return jsonify({
            "success": True,
            "analysis": {
                **result,
                "full_response": text
            }
        })

    except Exception as e:
        print(f"ERROR in compare_upload: {e}")
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e),
            "analysis": {
                "match": False,
                "confidence": 0,
                "reason": f"AI analysis failed: {str(e)}"
            }
        }), 500

if __name__ == '__main__':
    print(" CampusFinds AI Server")
    print("=" * 50)
    
    # Validate configuration
    is_valid = validate_config()
    
    print(f"    Gemini: {' Connected' if GEMINI_API_KEY else ' MISSING KEY'}")
    print(f"   ️  Supabase: {' Connected' if SUPABASE_URL else ' MISSING URL'}")
    print(f"    Host: {FLASK_HOST}:{FLASK_PORT}")
    print(f"    Debug: {FLASK_DEBUG}")
    print("=" * 50)
    
    if not is_valid:
        print("\n️  Starting with missing configuration. Some features may not work.\n")
    
    app.run(host=FLASK_HOST, port=FLASK_PORT, debug=FLASK_DEBUG)