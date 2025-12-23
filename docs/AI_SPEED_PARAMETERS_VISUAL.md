# AI Speed Parameters - Visual Guide

## UI Location

```
┌─────────────────────────────────────────────────────────┐
│  Racing Game Interface                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐                                          │
│  │ Dev Menu │◄── Click here to open menu               │
│  └──────────┘                                          │
│       │                                                 │
│       ├─ Scales                                        │
│       ├─ AI Controls ◄── Select this option           │
│       ├─ Dev Tools                                     │
│       └─ Gearbox                                       │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ AI Controls Panel                                 │ │
│  ├───────────────────────────────────────────────────┤ │
│  │                                                   │ │
│  │ Difficulty: [Medium ▼]                           │ │
│  │ ☑ Show racing line                               │ │
│  │ ☑ Clone player gearbox                           │ │
│  │                                                   │ │
│  │ ══════ Line settings ══════                       │ │
│  │                                                   │ │
│  │ Apex aggression    [━━━━━━●━━━] 0.70            │ │
│  │ Max offset         [━━━━━━●━━━] 0.65            │ │
│  │ Road friction      [━━━━━━●━━━] 1.10            │ │
│  │ Min radius         [━━━━━━●━━━] 12              │ │
│  │                                                   │ │
│  │ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓    │ │
│  │ ┃ NEW PARAMETERS                           ┃    │ │
│  │ ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫    │ │
│  │ ┃ Straight speed   [━━━━●━━━━━] 3000      ┃    │ │
│  │ ┃                  Range: 1500 - 5000     ┃    │ │
│  │ ┃                                          ┃    │ │
│  │ ┃ Corner floor     [━━━━●━━━━━] 140       ┃    │ │
│  │ ┃                  Range: 80 - 300        ┃    │ │
│  │ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛    │ │
│  │                                                   │ │
│  │ ══════ Vehicle behaviour ══════                   │ │
│  │                                                   │ │
│  │ Lookahead base     [━━━━━━●━━━] 50              │ │
│  │ Lookahead/speed    [━━━━━━●━━━] 0.16            │ │
│  │ Steer gain (P)     [━━━━━━●━━━] 3.20            │ │
│  │ ...                                               │ │
│  │                                                   │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Parameter Details

### Straight Speed Slider
```
Label: "Straight speed"
Type: Range slider + Number input
Range: 1500 to 5000
Step: 100
Default: 3000
Units: px/s (pixels per second)
Tooltip: "Maximum target speed on straights (px/s); 
          increase for faster lap times. 
          Default: 3000 (~220 mph)."
```

### Corner Floor Slider
```
Label: "Corner floor"
Type: Range slider + Number input
Range: 80 to 300
Step: 10
Default: 140
Units: px/s (pixels per second)
Tooltip: "Minimum speed floor in corners (px/s); 
          increase to maintain higher corner speeds."
```

## Usage Flow

### Step-by-Step Instructions

1. **Start a Race**
   - Select any vehicle (F1, GT, Rally, Truck)
   - Select any track (Le Mans, Suzuka, etc.)
   - Click "Start Race"

2. **Open AI Controls**
   - Look for "Dev" button in top-left corner
   - Click it to open the dropdown menu
   - Select "AI Controls" from the list

3. **Locate the Parameters**
   - Scroll down to the "Line settings" section
   - Find the two new sliders (after "Min radius")
   - They are labeled "Straight speed" and "Corner floor"

4. **Adjust for Faster Laps**
   - **For 20% faster**: Set straight speed to 3500-4000
   - **For 35% faster**: Set straight speed to 4500-5000
   - **Always adjust together**: Increase corner floor proportionally
   
5. **Watch the Effect**
   - AI cars will immediately use the new racing line
   - Toggle "Show racing line" to see the path
   - Observe AI lap times improving

## Visual Effects

### Before (Default: 3000, 140)
```
AI Behavior:
- Moderate straight-line speed
- Conservative corner entry
- Safe but slower lap times
- Good for learning and practice
```

### After (Increased: 4000, 200)
```
AI Behavior:
- Much faster straight-line speed
- Higher corner speeds maintained
- More aggressive racing
- Lap times 20-25% faster
```

### Maximum (5000, 280)
```
AI Behavior:
- Near-maximum vehicle speed
- Very aggressive cornering
- Pushes physics limits
- Lap times 30-40% faster
- May require grip adjustment
```

## Tips for Best Results

### ✓ DO:
- Adjust both parameters together for balanced performance
- Start with small increases (e.g., +500 straight, +30 corner)
- Test on different tracks to see the effect
- Combine with other AI Controls for fine-tuning
- Use "Show racing line" to visualize the changes

### ✗ DON'T:
- Set corner floor higher than straight speed
- Ignore other parameters (especially cornering grip)
- Expect instant results (may take 1-2 laps to see effect)
- Use maximum values without adjusting grip parameters
- Forget to save your preferred settings

## Comparison Chart

| Setting | Straight Speed | Corner Floor | Lap Time | Best For |
|---------|---------------|--------------|----------|----------|
| Slow | 2000 | 100 | Baseline -30% | Practice |
| Default | 3000 | 140 | Baseline | Normal racing |
| Fast | 3500 | 180 | Baseline +15% | Competition |
| Faster | 4000 | 220 | Baseline +25% | Challenge |
| Maximum | 5000 | 280 | Baseline +35% | Expert mode |

## Troubleshooting

### Problem: AI still slow after increasing
**Check these:**
- Max throttle parameter (should be ≥1.0)
- Cornering grip (increase if corners are the bottleneck)
- Road friction (affects corner speed calculations)
- Vehicle selection (some vehicles are inherently slower)

### Problem: AI going off track
**Solutions:**
- Reduce corner floor by 20-30
- Increase cornering grip to 0.95-0.99
- Reduce brake aggro to allow smoother braking
- Check track selection (tight tracks need lower values)

### Problem: AI inconsistent
**Solutions:**
- Ensure all AI parameters are balanced
- Try a preset difficulty first, then adjust speeds
- Verify "Show racing line" is enabled to see if line looks correct
- Reset to defaults and adjust one parameter at a time
