# 原生产物验证：APK 里的 dex 真的带上了某个类（Day 32）。
# 为什么不能直接搜 APK：dex 在 zip 里是压缩的，拿原始字节搜类名永远搜不到，
# 会得出「插件没打进包」这种错误结论。必须先解压出 classes*.dex 再搜。
#
# 用法：py -3 web2/tmp/verify-native-dex.py <apk> <字符串1> [字符串2 ...]
#   每个字符串都会在全部 classes*.dex 里逐个搜；全部命中 = exit 0，否则 exit 1。
import sys, zipfile

def main():
    if len(sys.argv) < 3:
        print('用法：py -3 verify-native-dex.py <apk> <字符串1> [字符串2 ...]')
        return 2
    apk, needles = sys.argv[1], sys.argv[2:]
    with zipfile.ZipFile(apk) as z:
        dexes = [n for n in z.namelist() if n.startswith('classes') and n.endswith('.dex')]
        if not dexes:
            print('[失败] APK 里没有 classes*.dex: ' + apk)
            return 1
        print('APK: ' + apk)
        print('dex 文件: ' + ', '.join(dexes))
        blobs = [(n, z.read(n)) for n in dexes]
        bad = 0
        for need in needles:
            pat = need.encode('utf-8')
            hits = [n for n, b in blobs if pat in b]
            if hits:
                print('  命中 ' + need + '  ->  ' + ', '.join(hits))
            else:
                print('  缺失 ' + need + '  ->  **没打进包**')
                bad += 1
    if bad:
        print('结论：有 ' + str(bad) + ' 个字符串缺失')
        return 1
    print('结论：全部命中')
    return 0

if __name__ == '__main__':
    sys.exit(main())