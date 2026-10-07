---
date: 2026-10-07 23:45
area: Bug fixes
title: Keep magical effects from blacking out the view
---
- Protected the glow renderer against invalid effect colours that could spread into huge flashing black rectangles when looking around. Normal bloom and visual detail remain enabled.
