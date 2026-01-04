# AI Controls Panel - Parameter Reference

## Overview
The AI Controls panel provides comprehensive control over AI racing behavior, including racing line generation, steering dynamics, speed control, and grip management.

## Parameter Categories

### Difficulty Preset
- **difficulty**: Loads a skill preset (easy/medium/hard) that sets base values for all other parameters

### Racing Line Generation
These parameters control how the AI's racing line is calculated:

- **maxOffset** (0.2-0.65)
  - Maximum distance the racing line can deviate from track centerline
  - Lower = stays closer to center
  - Higher = uses more track width
  - Default: 0.65

### Lookahead & Tracking
These parameters control how the AI follows the racing line:

- **lookaheadBase** (20-80 pixels)
  - Base distance ahead the AI looks when moving slowly
  - Higher = smoother but less reactive
  - Lower = more reactive but can be twitchy
  - Default: varies by difficulty (35-42)

- **lookaheadSpeed** (0.08-0.25)
  - Additional lookahead multiplied by current speed
  - Higher = anticipates turns earlier at speed
  - Default: varies by difficulty (0.12-0.17)

- **searchWindow** (30-100)
  - Size of window for finding closest racing line point
  - Larger = more stable line tracking but slower updates
  - Smaller = faster updates but may lose line
  - Default: varies by difficulty (48-80)

### Steering Control
PD (Proportional-Derivative) controller for steering:

- **steerP** (0.8-5.0)
  - Proportional gain - primary steering responsiveness
  - Higher = faster reaction to errors
  - Too high = oscillation/weaving
  - Default: varies by difficulty (1.6-3.8)

- **steerD** (0-0.5)
  - Derivative gain - dampens steering oscillation
  - Higher = smoother steering, less overshoot
  - Too high = sluggish steering
  - Default: varies by difficulty (0.06-0.22)

### Speed & Throttle Control

- **maxThrottle** (0.6-1.5)
  - Controls both throttle application and top speed scaling
  - <1.0 = reduced throttle and speed
  - >1.0 = boosted throttle and speed
  - Default: varies by difficulty (0.85-1.5)

### Braking Control

- **brakeAggro** (0.4-1.8)
  - Multiplier for all brake commands
  - <1.0 = gentler braking
  - >1.0 = more aggressive braking
  - Default: varies by difficulty (0.8-1.5)

- **brakingLookaheadFactor** (0.8-2.0)
  - Distance ahead to scan for upcoming slow corners
  - Higher = brakes earlier/more cautiously
  - Lower = brakes later/more aggressively
  - Default: varies by difficulty (1.2-1.4)

### Grip Management
These parameters control the traction circle - how the AI balances steering vs acceleration/braking:

- **corneringGrip** (0.7-1.0)
  - Grip confidence multiplier for calculating corner speeds
  - Lower = takes corners more conservatively
  - Higher = pushes grip limits harder
  - Default: varies by difficulty (0.75-0.99)

- **slipThreshold** (0.7-1.0)
  - Traction circle limit for combined inputs
  - Controls how much steering+braking can be used simultaneously
  - Lower = more conservative, less combined input
  - Higher = pushes traction limits
  - Default: varies by difficulty (0.8-1.0)

## Difficulty Presets

### Easy
- Conservative cornering (corneringGrip: 0.75)
- Gentle inputs (maxThrottle: 0.85, brakeAggro: 0.8)
- Stable steering (steerP: 1.6, steerD: 0.06)
- Early braking (brakingLookaheadFactor: 1.2)
- Safe traction limits (slipThreshold: 0.8)

### Medium
- Balanced approach (corneringGrip: 0.95)
- Normal inputs (maxThrottle: 1.0, brakeAggro: 1.0)
- Moderate steering (steerP: 2.1, steerD: 0.1)
- Standard braking (brakingLookaheadFactor: 1.4)
- Standard traction (slipThreshold: 0.95)

### Hard
- Aggressive cornering (corneringGrip: 0.99)
- Boosted inputs (maxThrottle: 1.5, brakeAggro: 1.5)
- Responsive steering (steerP: 3.8, steerD: 0.22)
- Calibrated braking (brakingLookaheadFactor: 1.3)
- Maximum traction (slipThreshold: 1.0)

## Tuning Tips

### AI Too Slow in Corners
- Increase `corneringGrip` (more aggressive cornering)
- Reduce `brakingLookaheadFactor` (brake later)

### AI Too Fast / Crashes in Corners
- Decrease `corneringGrip` (more conservative)
- Increase `brakingLookaheadFactor` (brake earlier)
- Decrease `slipThreshold` (less combined input)

### AI Weaving / Oscillating
- Increase `steerD` (more damping)
- Decrease `steerP` (less reactive)
- Increase `lookaheadBase` (look further ahead)

### AI Losing Racing Line
- Increase `searchWindow` (more stable tracking)
- Adjust `lookaheadSpeed` (speed-based anticipation)

### Fine-Tuning Racing Line
- **maxOffset**: Limits how wide the line goes
- Affects straightening through lumpy sections


