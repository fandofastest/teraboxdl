import os
import re
import sys
import time
import requests
from urllib.parse import urlparse, parse_qs

# Set UTF-8 encoding untuk console Windows
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

COOKIE_FILE = os.path.join(os.path.dirname(__file__), "cookie.txt")

def parse_cookie_file():
    """Membaca cookie dari cookie.txt dalam format Netscape maupun key=value."""
    if not os.path.exists(COOKIE_FILE):
        return ""
    with open(COOKIE_FILE, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()

    cookies_dict = {}
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 7:
            cookies_dict[parts[5].strip()] = parts[6].strip()
        elif "=" in line:
            for p in line.split(";"):
                p = p.strip()
                if "=" in p and not p.startswith("#"):
                    k, v = p.split("=", 1)
                    cookies_dict[k.strip()] = v.strip()

    return "; ".join([f"{k}={v}" for k, v in cookies_dict.items()])

def format_size(bytes_size):
    try:
        bytes_size = float(bytes_size)
    except (ValueError, TypeError):
        return "Unknown Size"
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if bytes_size < 1024.0:
            return f"{bytes_size:.2f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.2f} PB"

def extract_surl(url):
    """Mengekstrak surl dari berbagai variasi URL Terabox."""
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    if "surl" in params:
        surl = params["surl"][0]
        return surl if surl.startswith("1") else "1" + surl
    m = re.search(r'/s/(?:1)?([a-zA-Z0-9_-]+)', url)
    if m:
        return "1" + m.group(1)
    return None

def fetch_terabox_info(link, cookie_str):
    """Mengambil metadata file menggunakan endpoint shorturlinfo Terabox."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Cookie": cookie_str,
        "Referer": link
    }
    
    # Ikuti redirect link awal jika shortlink
    try:
        r_init = requests.head(link, headers=headers, allow_redirects=True, timeout=15)
        final_url = r_init.url
    except Exception:
        final_url = link

    surl = extract_surl(final_url) or extract_surl(link)
    if not surl:
        return {"error": "Format link Terabox tidak valid atau surl tidak ditemukan."}

    api_url = f"https://www.terabox.app/api/shorturlinfo?shorturl={surl}&root=1"
    
    try:
        r = requests.get(api_url, headers=headers, timeout=20)
        data = r.json()
    except Exception as e:
        return {"error": f"Gagal menghubungi server Terabox: {e}"}

    if data.get("errno") != 0 or "list" not in data or len(data["list"]) == 0:
        err_msg = data.get("errmsg", "Link tidak ditemukan atau telah dihapus.")
        return {"error": f"Terabox API Error: {err_msg}"}

    files = []
    uk = data.get("uk")
    shareid = data.get("shareid")
    sign = data.get("sign")
    timestamp = data.get("timestamp")

    for item in data["list"]:
        fs_id = item.get("fs_id")
        filename = item.get("server_filename", "file_download")
        size = int(item.get("size", 0))
        category = item.get("category")
        
        # Coba ambil link stream / m3u8 jika video
        stream_m3u8_url = f"https://www.terabox.app/share/streaming?app_id=250528&web=1&channel=dubox&clienttype=0&uk={uk}&shareid={shareid}&type=M3U8_AUTO_480&fid={fs_id}&sign={sign}&timestamp={timestamp}"
        
        files.append({
            "fs_id": fs_id,
            "filename": filename,
            "size": size,
            "category": category,
            "stream_url": stream_m3u8_url,
            "dlink": item.get("dlink") or "",
            "uk": uk,
            "shareid": shareid,
            "sign": sign,
            "timestamp": timestamp
        })

    return {"files": files, "metadata": data}

def download_video_stream(stream_url, output_path, cookie_str):
    """Mengunduh video via potongan segment TS langsung dari playlist m3u8."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Cookie": cookie_str,
        "Referer": "https://www.terabox.app/"
    }
    
    r = requests.get(stream_url, headers=headers, timeout=20)
    if r.status_code != 200 or "#EXTM3U" not in r.text:
        raise Exception(f"Gagal mengambil manifest m3u8 (Status {r.status_code})")
        
    ts_urls = [line.strip() for line in r.text.splitlines() if line.strip() and line.strip().startswith("http")]
    
    if not ts_urls:
        raise Exception("Tidak ada segment video yang ditemukan dalam stream.")

    print(f"\n[+] Total Segment: {len(ts_urls)} bagian video")
    print(f"[+] Menyimpan ke  : {output_path}")

    start_time = time.time()
    downloaded_bytes = 0

    with open(output_path, "wb") as f_out:
        for idx, ts_url in enumerate(ts_urls, start=1):
            for attempt in range(3):
                try:
                    r_ts = requests.get(ts_url, headers=headers, timeout=30)
                    if r_ts.status_code == 200:
                        f_out.write(r_ts.content)
                        downloaded_bytes += len(r_ts.content)
                        elapsed = time.time() - start_time
                        speed = downloaded_bytes / elapsed if elapsed > 0 else 0
                        percent = (idx / len(ts_urls)) * 100
                        bar_len = 30
                        filled = int(bar_len * idx // len(ts_urls))
                        bar = "=" * filled + "-" * (bar_len - filled)
                        sys.stdout.write(f"\r[{bar}] {percent:.1f}% ({idx}/{len(ts_urls)}) | {format_size(downloaded_bytes)} | {format_size(speed)}/s")
                        sys.stdout.flush()
                        break
                except Exception:
                    if attempt == 2:
                        print(f"\n[!] Gagal mengunduh segment #{idx}")
                    time.sleep(1)

    print("\n[OK] Unduhan selesai dengan sukses!")

def main():
    print("=" * 60)
    print("       TERABOX FILE DOWNLOADER (CLI)")
    print("=" * 60)

    cookie_str = parse_cookie_file()
    if cookie_str:
        print("[OK] Cookie Terabox terdeteksi dari cookie.txt")
    else:
        print("[!] Peringatan: Cookie tidak ditemukan di cookie.txt")

    if len(sys.argv) > 1:
        target_url = sys.argv[1].strip()
    else:
        target_url = input("\nMasukkan Link Terabox: ").strip()

    if not target_url:
        print("[!] URL tidak boleh kosong!")
        return

    print("\n[*] Sedang mengambil metadata & informasi file...")
    result = fetch_terabox_info(target_url, cookie_str)

    if "error" in result or not result.get("files"):
        print(f"\n[x] Gagal: {result.get('error', 'Tidak ditemukan file.')}")
        return

    file_list = result["files"]
    print(f"\n[OK] Ditemukan {len(file_list)} file:")
    for idx, f in enumerate(file_list, start=1):
        print(f"  {idx}. {f['filename']} ({format_size(f['size'])})")

    selected_files = file_list
    if len(file_list) > 1:
        choice = input(f"\nPilih nomor file (1-{len(file_list)}) atau 'all' [default: all]: ").strip()
        if choice and choice.lower() != 'all':
            try:
                selected_idx = int(choice) - 1
                if 0 <= selected_idx < len(file_list):
                    selected_files = [file_list[selected_idx]]
            except ValueError:
                pass

    download_dir = os.path.join(os.getcwd(), "downloads")
    os.makedirs(download_dir, exist_ok=True)

    for f in selected_files:
        safe_name = "".join([c for c in f['filename'] if c.isalnum() or c in (' ', '.', '_', '-')]).rstrip()
        if not safe_name:
            safe_name = f"video_{int(time.time())}.mp4"

        output_file = os.path.join(download_dir, safe_name)

        print(f"\n[*] Memulai download: {f['filename']}")
        try:
            download_video_stream(f["stream_url"], output_file, cookie_str)
        except Exception as e:
            print(f"\n[x] Error saat mengunduh: {e}")

if __name__ == "__main__":
    main()
