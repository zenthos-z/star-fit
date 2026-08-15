import argparse
import json

def calculate_mev(scores):
    # Base values for MEV
    mev_base = {
        "squat": {"hypertrophy": 7.5, "strength": 5.5, "peaking": 4.5},
        "bench": {"hypertrophy": 9, "strength": 8, "peaking": 6.5},
        "deadlift": {"hypertrophy": 5.5, "strength": 4.5, "peaking": 2.5}
    }
    
    mev_scoring_map = {
        "gender": {"male": 0, "female": 1.5},
        "weight": {"super_heavy": -1.5, "heavy": -0.5, "normal": 0, "light": 1},
        "height": {"very_tall": -1, "tall": -0.5, "medium": 0, "short": 0.5},
        "strength_level": {"low": -0.5, "medium": 0, "high": 0.5, "very_high": 1},
        "experience": {"beginner": -1, "intermediate": -0.5, "advanced": 0.5, "very_advanced": 1},
        "age": {"under_19": -1, "20-29": -0.5, "30-39": 0, "40-49": 0.5, "over_50": 1},
        "diet": {"good": -0.5, "normal": 0, "poor": 0.5},
        "sleep": {"good": -0.5, "normal": 0, "poor": 0.5},
        "stress": {"low": -0.5, "normal": 0, "high": 0.5},
        "hist_volume": {"1": -1, "2": -0.5, "3": 0, "4": 0.5, "5": 1},
        "hist_recovery": {"1": -1, "2": -0.5, "3": 0, "4": 0.5, "5": 1}
    }
    
    total_score = sum(mev_scoring_map.get(k, {}).get(v, 0) for k, v in scores.items())
    
    results = {}
    for exercise, phases in mev_base.items():
        results[exercise] = {phase: base + total_score for phase, base in phases.items()}
    return results, total_score

def calculate_mrv(scores):
    # Base values for MRV
    mrv_base = {
        "squat": {"hypertrophy": 14, "strength": 9, "peaking": 6},
        "bench": {"hypertrophy": 17, "strength": 11, "peaking": 8.5},
        "deadlift": {"hypertrophy": 11, "strength": 7, "peaking": 4.5}
    }
    
    mrv_scoring_map = {
        "gender": {"male": -1, "female": 3},
        "weight": {"super_heavy": -4, "heavy": -2, "normal": 1, "light": 3},
        "height": {"very_tall": -2, "tall": -1, "medium": 1, "short": 2},
        "strength_level": {"very_high": -4, "high": -2, "medium": 0, "low": 1},
        "experience": {"very_advanced": -2, "beginner_advanced": 0, "intermediate": 2},
        "age": {"over_50": -4, "40-49": -1, "30-39": 0, "20-29": 1, "under_19": 2},
        "diet": {"poor": -2, "normal": 0, "good": 1},
        "sleep": {"poor": -2, "normal": 0, "good": 1},
        "stress": {"high": -2, "normal": 0, "low": 1},
        "hist_volume": {"1": -2, "2": -1, "3": 0, "4": 1, "5": 2},
        "hist_recovery": {"1": -2, "2": -1, "3": 0, "4": 1, "5": 2}
    }
    
    total_score = sum(mrv_scoring_map.get(k, {}).get(v, 0) for k, v in scores.items())
    
    results = {}
    for exercise, phases in mrv_base.items():
        results[exercise] = {phase: base + total_score for phase, base in phases.items()}
    return results, total_score

def main():
    parser = argparse.ArgumentParser(description="Calculate MEV and MRV for strength training.")
    parser.add_argument("--gender", choices=["male", "female"], required=True)
    parser.add_argument("--weight", choices=["super_heavy", "heavy", "normal", "light"], required=True)
    parser.add_argument("--height", choices=["very_tall", "tall", "medium", "short"], required=True)
    parser.add_argument("--strength_level", choices=["very_high", "high", "medium", "low"], required=True)
    parser.add_argument("--experience", choices=["beginner", "intermediate", "advanced", "very_advanced", "beginner_advanced"], required=True)
    parser.add_argument("--age", choices=["under_19", "20-29", "30-39", "40-49", "over_50"], required=True)
    parser.add_argument("--diet", choices=["good", "normal", "poor"], required=True)
    parser.add_argument("--sleep", choices=["good", "normal", "poor"], required=True)
    parser.add_argument("--stress", choices=["low", "normal", "high"], required=True)
    parser.add_argument("--hist_volume", choices=["1", "2", "3", "4", "5"], required=True)
    parser.add_argument("--hist_recovery", choices=["1", "2", "3", "4", "5"], required=True)
    
    args = parser.parse_args()
    scores = vars(args)
    
    mev_results, mev_total = calculate_mev(scores)
    mrv_results, mrv_total = calculate_mrv(scores)
    
    output = {
        "mev_total_score": mev_total,
        "mrv_total_score": mrv_total,
        "mev": mev_results,
        "mrv": mrv_results
    }
    
    print(json.dumps(output, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
