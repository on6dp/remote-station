// qtshim.h — remplacements minimaux des classes Qt utilisées par le cœur DRM de QSSTV (sans Qt)
#ifndef QTSHIM_H
#define QTSHIM_H
#include <string>
#include <vector>
#include <cstring>
#include <cstdio>
#include <algorithm>
#include <sstream>
typedef unsigned int uint;
typedef unsigned int quint32;
typedef int qint32;
typedef unsigned short quint16;
typedef short qint16;
typedef unsigned char quint8;
typedef unsigned long long quint64;
class QByteArray {
public:
  std::vector<char> d;
  QByteArray() {}
  QByteArray(const char *p, int n) { if (p && n > 0) d.assign(p, p + n); }
  QByteArray(const char *p) { if (p) d.assign(p, p + strlen(p)); }
  QByteArray(int n, char c) { d.assign(n, c); }
  int count() const { return (int)d.size(); }
  int size() const { return (int)d.size(); }
  int length() const { return (int)d.size(); }
  bool isEmpty() const { return d.empty(); }
  char *data() { if (d.empty()) d.reserve(1); return d.data(); }
  const char *data() const { return d.data(); }
  const char *constData() const { return d.data(); }
  char at(int i) const { return d[i]; }
  char &operator[](int i) { return d[i]; }
  char operator[](int i) const { return d[i]; }
  void resize(int n) { d.resize(n); }
  void clear() { d.clear(); }
  QByteArray &fill(char c, int n = -1) { if (n >= 0) d.assign(n, c); else std::fill(d.begin(), d.end(), c); return *this; }
  QByteArray &append(const QByteArray &o) { d.insert(d.end(), o.d.begin(), o.d.end()); return *this; }
  QByteArray &append(const char *p, int n) { d.insert(d.end(), p, p + n); return *this; }
  QByteArray &append(char c) { d.push_back(c); return *this; }
  QByteArray &remove(int pos, int n) { if (pos < (int)d.size()) d.erase(d.begin() + pos, d.begin() + std::min((int)d.size(), pos + n)); return *this; }
  void chop(int n) { d.resize(n >= (int)d.size() ? 0 : d.size() - n); }
  QByteArray mid(int pos, int n = -1) const { if (pos >= (int)d.size()) return QByteArray(); int e = n < 0 ? (int)d.size() : std::min((int)d.size(), pos + n); return QByteArray(d.data() + pos, e - pos); }
  QByteArray left(int n) const { return mid(0, n); }
  QByteArray right(int n) const { return n >= (int)d.size() ? *this : mid((int)d.size() - n); }
  QByteArray &operator+=(const QByteArray &o) { return append(o); }
  QByteArray &operator+=(char c) { return append(c); }
  bool operator==(const QByteArray &o) const { return d == o.d; }
  void push_back(char c) { d.push_back(c); }
  QByteArray leftJustified(int n, char c = ' ') const { QByteArray r = *this; if ((int)r.d.size() < n) r.d.resize(n, c); return r; }
};
class QString {
public:
  std::string s;
  QString() {}
  QString(const char *p) : s(p ? p : "") {}
  QString(const std::string &x) : s(x) {}
  QString(char c) : s(1, c) {}
  QString(const QByteArray &b) : s(b.d.data(), strnlen(b.d.data(), b.d.size())) {}
  bool isEmpty() const { return s.empty(); }
  int length() const { return (int)s.size(); }
  int count() const { return (int)s.size(); }
  int size() const { return (int)s.size(); }
  QByteArray toLatin1() const { return QByteArray(s.c_str(), (int)s.size() + 1); }
  QByteArray toUtf8() const { return toLatin1(); }
  QByteArray toLocal8Bit() const { return toLatin1(); }
  std::string toStdString() const { return s; }
  QString left(int n) const { return QString(s.substr(0, n)); }
  QString mid(int p, int n = -1) const { return p >= (int)s.size() ? QString() : QString(n < 0 ? s.substr(p) : s.substr(p, n)); }
  QString toUpper() const { std::string r = s; for (auto &c : r) c = toupper(c); return r; }
  QString trimmed() const { size_t a = s.find_first_not_of(" \t\r\n"); if (a == std::string::npos) return QString(); size_t b = s.find_last_not_of(" \t\r\n"); return s.substr(a, b - a + 1); }
  QString &operator+=(const QString &o) { s += o.s; return *this; }
  QString operator+(const QString &o) const { return QString(s + o.s); }
  bool operator==(const QString &o) const { return s == o.s; }
  bool operator!=(const QString &o) const { return s != o.s; }
  QString arg(const QString &a) const { return rep(a.s); }
  QString arg(const char *a) const { return rep(a ? a : ""); }
  QString arg(int v, int = 0, int base = 10, char = ' ') const { std::ostringstream o; if (base == 16) o << std::hex; o << v; return rep(o.str()); }
  QString arg(unsigned v, int = 0, int base = 10, char = ' ') const { std::ostringstream o; if (base == 16) o << std::hex; o << v; return rep(o.str()); }
  QString arg(long v, int = 0, int = 10, char = ' ') const { return rep(std::to_string(v)); }
  QString arg(unsigned long v, int = 0, int = 10, char = ' ') const { return rep(std::to_string(v)); }
  QString arg(double v, int = 0, char = 'g', int = -1, char = ' ') const { std::ostringstream o; o << v; return rep(o.str()); }
  static QString number(double v) { std::ostringstream o; o << v; return QString(o.str()); }
  static QString number(int v) { return QString(std::to_string(v)); }
  const char *c_str() const { return s.c_str(); }
  QString leftJustified(int n, char c = ' ') const { std::string r = s; if ((int)r.size() < n) r.resize(n, c); return QString(r); }
  void append(const QString &o) { s += o.s; }
  void append(const char *o) { s += o; }
  static QString fromLatin1(const char *p) { return QString(p); }
private:
  QString rep(const std::string &v) const {
    // remplace le plus petit %n présent
    int best = 100; size_t pos = std::string::npos, len = 0;
    for (size_t i = 0; i + 1 < s.size(); i++) if (s[i] == '%' && isdigit((unsigned char)s[i + 1])) {
      int n = s[i + 1] - '0'; size_t l = 2; if (i + 2 < s.size() && isdigit((unsigned char)s[i + 2])) { n = n * 10 + (s[i + 2] - '0'); l = 3; }
      if (n < best) { best = n; pos = i; len = l; }
    }
    if (pos == std::string::npos) return *this;
    std::string r = s; r.replace(pos, len, v); return QString(r);
  }
};
inline QString operator+(const char *a, const QString &b) { return QString(std::string(a ? a : "") + b.s); }
template <class T> class QList : public std::vector<T> {
public:
  int count() const { return (int)this->size(); }
  int length() const { return (int)this->size(); }
  bool isEmpty() const { return this->empty(); }
  void append(const T &v) { this->push_back(v); }
  void prepend(const T &v) { this->insert(this->begin(), v); }
  const T &at(int i) const { return (*this)[i]; }
  void removeAt(int i) { this->erase(this->begin() + i); }
  void removeFirst() { if (!this->empty()) this->erase(this->begin()); }
  T takeFirst() { T v = this->front(); this->erase(this->begin()); return v; }
  T takeAt(int i) { T v = (*this)[i]; this->erase(this->begin() + i); return v; }
  const T &first() const { return this->front(); }
  const T &last() const { return this->back(); }
  bool contains(const T &v) const { return std::find(this->begin(), this->end(), v) != this->end(); }
  int indexOf(const T &v) const { auto it = std::find(this->begin(), this->end(), v); return it == this->end() ? -1 : (int)(it - this->begin()); }
  QList &operator<<(const T &v) { this->push_back(v); return *this; }
};
template <class T> class QVector : public QList<T> {};
class QObject { public: QObject(QObject * = 0) {} virtual ~QObject() {} };
#define Q_OBJECT
#define signals public
#define slots
#define emit
class QMutex { public: void lock() {} void unlock() {} };
class QMutexLocker { public: QMutexLocker(QMutex *) {} };
struct QDebugNull { template <class T> QDebugNull &operator<<(const T &) { return *this; } };
inline QDebugNull qDebug() { return QDebugNull(); }
inline QDebugNull errorOut() { return QDebugNull(); }
class QFile { public: void setFileName(const QString &) {} };
class QFileInfo { public: std::string f; QFileInfo(const QString &x) : f(x.s) {}
  QString fileName() const { size_t p = f.find_last_of('/'); return QString(p == std::string::npos ? f : f.substr(p + 1)); }
  QString completeBaseName() const { std::string n = fileName().s; size_t d = n.find_last_of('.'); return QString(d == std::string::npos ? n : n.substr(0, d)); }
  QString suffix() const { std::string n = fileName().s; size_t d = n.find_last_of('.'); return QString(d == std::string::npos ? std::string() : n.substr(d + 1)); } };
#endif
