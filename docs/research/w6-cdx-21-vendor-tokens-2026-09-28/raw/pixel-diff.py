# Pixel-diff every capture in before/ against after/: changed pixels and their bounding box.
import os, sys
from PIL import Image, ImageChops
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.join(here, '..')
for f in sorted(os.listdir(os.path.join(root, 'after'))):
    a = Image.open(os.path.join(root, 'before', f)).convert('RGB')
    b = Image.open(os.path.join(root, 'after', f)).convert('RGB')
    d = ImageChops.difference(a, b)
    n = sum(1 for p in d.getdata() if p != (0, 0, 0))
    print(f'{f:36s} changed px={n:6d} bbox={d.getbbox()}')
