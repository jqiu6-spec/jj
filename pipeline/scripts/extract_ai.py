import sys, zlib
from pypdf import PdfReader
src, out = sys.argv[1], sys.argv[2]
r = PdfReader(src)
page = r.pages[0]
pi = page.get("/PieceInfo")
priv = pi["/Illustrator"]["/Private"].get_object()
n = int(priv["/NumBlock"])
data = b""
for i in range(1, n+1):
    s = priv[f"/AIPrivateData{i}"].get_object()
    data += s.get_data()
print(len(data), data[:200])
open(out, "wb").write(data)
