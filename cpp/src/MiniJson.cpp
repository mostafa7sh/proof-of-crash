#include "MiniJson.h"

#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace poc::minijson {

// ─── Constructors / copy / move / dtor ───────────────────────────────────────

Value::Value() = default;
Value::Value(std::nullptr_t) {}

Value::Value(bool b)   : type_(Type::Bool),   boolVal_(b)   {}
Value::Value(int i)                : type_(Type::Int), intVal_(i) {}
Value::Value(unsigned u)           : type_(Type::Int), intVal_(static_cast<long long>(u)) {}
Value::Value(long i)               : type_(Type::Int), intVal_(i) {}
Value::Value(unsigned long u)      : type_(Type::Int), intVal_(static_cast<long long>(u)) {}
Value::Value(long long i)          : type_(Type::Int), intVal_(i) {}
Value::Value(unsigned long long u) : type_(Type::Int), intVal_(static_cast<long long>(u)) {}
Value::Value(double d) : type_(Type::Double), doubleVal_(d) {}

Value::Value(const char* s) : type_(Type::String), stringVal_(s ? s : "") {}
Value::Value(std::string s) : type_(Type::String), stringVal_(std::move(s)) {}

Value::Value(std::initializer_list<std::pair<std::string, Value>> init)
    : type_(Type::Object),
      objectVal_(std::make_unique<ObjectEntries>()) {
    objectVal_->reserve(init.size());
    for (const auto& kv : init) {
        objectVal_->emplace_back(kv.first, kv.second);
    }
}

Value::Value(const Value& other) {
    type_ = other.type_;
    boolVal_ = other.boolVal_;
    intVal_ = other.intVal_;
    doubleVal_ = other.doubleVal_;
    stringVal_ = other.stringVal_;
    if (other.arrayVal_)  arrayVal_  = std::make_unique<ArrayEntries>(*other.arrayVal_);
    if (other.objectVal_) objectVal_ = std::make_unique<ObjectEntries>(*other.objectVal_);
}

Value::Value(Value&& other) noexcept = default;
Value& Value::operator=(Value&& other) noexcept = default;
Value::~Value() = default;

Value& Value::operator=(const Value& other) {
    if (this == &other) return *this;
    Value tmp(other);
    *this = std::move(tmp);
    return *this;
}

Value Value::array()  {
    Value v;
    v.type_ = Type::Array;
    v.arrayVal_ = std::make_unique<ArrayEntries>();
    return v;
}

Value Value::object() {
    Value v;
    v.type_ = Type::Object;
    v.objectVal_ = std::make_unique<ObjectEntries>();
    return v;
}

// ─── Accessors ───────────────────────────────────────────────────────────────

bool Value::asBool() const {
    if (type_ != Type::Bool) throw ParseError("expected bool");
    return boolVal_;
}

long long Value::asInt() const {
    if (type_ == Type::Int)    return intVal_;
    if (type_ == Type::Double) return static_cast<long long>(doubleVal_);
    throw ParseError("expected number");
}

double Value::asDouble() const {
    if (type_ == Type::Double) return doubleVal_;
    if (type_ == Type::Int)    return static_cast<double>(intVal_);
    throw ParseError("expected number");
}

const std::string& Value::asString() const {
    if (type_ != Type::String) throw ParseError("expected string");
    return stringVal_;
}

const ArrayEntries& Value::asArray() const {
    if (type_ != Type::Array) throw ParseError("expected array");
    return *arrayVal_;
}
ArrayEntries& Value::asArray() {
    if (type_ != Type::Array) throw ParseError("expected array");
    return *arrayVal_;
}

const ObjectEntries& Value::asObject() const {
    if (type_ != Type::Object) throw ParseError("expected object");
    return *objectVal_;
}
ObjectEntries& Value::asObject() {
    if (type_ != Type::Object) throw ParseError("expected object");
    return *objectVal_;
}

bool Value::contains(std::string_view key) const {
    if (type_ != Type::Object || !objectVal_) return false;
    for (const auto& [k, _] : *objectVal_) if (k == key) return true;
    return false;
}

const Value& Value::at(std::string_view key) const {
    if (type_ != Type::Object || !objectVal_) {
        throw ParseError("at(\"" + std::string(key) + "\") on non-object");
    }
    for (const auto& [k, v] : *objectVal_) if (k == key) return v;
    throw ParseError("key not found: " + std::string(key));
}

Value& Value::operator[](std::string_view key) {
    if (type_ == Type::Null) {
        type_ = Type::Object;
        objectVal_ = std::make_unique<ObjectEntries>();
    }
    if (type_ != Type::Object) throw ParseError("operator[] on non-object");
    for (auto& [k, v] : *objectVal_) if (k == key) return v;
    objectVal_->emplace_back(std::string(key), Value{});
    return objectVal_->back().second;
}

size_t Value::size() const {
    if (type_ == Type::Array)  return arrayVal_  ? arrayVal_->size()  : 0;
    if (type_ == Type::Object) return objectVal_ ? objectVal_->size() : 0;
    return 0;
}

void Value::push_back(Value v) {
    if (type_ == Type::Null) {
        type_ = Type::Array;
        arrayVal_ = std::make_unique<ArrayEntries>();
    }
    if (type_ != Type::Array) throw ParseError("push_back on non-array");
    arrayVal_->emplace_back(std::move(v));
}

Value& Value::operator[](size_t idx) {
    if (type_ != Type::Array || !arrayVal_) throw ParseError("operator[idx] on non-array");
    return arrayVal_->at(idx);
}

const Value& Value::operator[](size_t idx) const {
    if (type_ != Type::Array || !arrayVal_) throw ParseError("operator[idx] on non-array");
    return arrayVal_->at(idx);
}

ArrayEntries::iterator       Value::begin()       { return asArray().begin(); }
ArrayEntries::iterator       Value::end()         { return asArray().end(); }
ArrayEntries::const_iterator Value::begin() const { return asArray().begin(); }
ArrayEntries::const_iterator Value::end()   const { return asArray().end(); }

// ─── Typed extraction ────────────────────────────────────────────────────────

// Note: on common platforms uint32_t aliases to unsigned, so the unsigned
// specialization satisfies get<uint32_t>() / value<uint32_t>() too.

template<> std::string Value::get<std::string>() const { return asString(); }
template<> bool        Value::get<bool>()        const { return asBool(); }
template<> double      Value::get<double>()      const { return asDouble(); }
template<> long long   Value::get<long long>()   const { return asInt(); }
template<> int         Value::get<int>()         const { return static_cast<int>(asInt()); }
template<> unsigned    Value::get<unsigned>()    const { return static_cast<unsigned>(asInt()); }
template<> uint16_t    Value::get<uint16_t>()    const { return static_cast<uint16_t>(asInt()); }

template<> std::string Value::value<std::string>(std::string_view key, std::string def) const {
    if (!contains(key)) return def;
    const Value& v = at(key);
    return v.isString() ? v.asString() : def;
}
template<> int Value::value<int>(std::string_view key, int def) const {
    if (!contains(key)) return def;
    const Value& v = at(key);
    return v.isNumber() ? static_cast<int>(v.asInt()) : def;
}
template<> unsigned Value::value<unsigned>(std::string_view key, unsigned def) const {
    if (!contains(key)) return def;
    const Value& v = at(key);
    return v.isNumber() ? static_cast<unsigned>(v.asInt()) : def;
}
template<> Value Value::value<Value>(std::string_view key, Value def) const {
    if (!contains(key)) return def;
    return at(key);
}

// ─── Serialization ───────────────────────────────────────────────────────────

static void writeString(const std::string& s, std::string& out) {
    out.push_back('"');
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b";  break;
            case '\f': out += "\\f";  break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned char>(c));
                    out += buf;
                } else {
                    out.push_back(c);
                }
        }
    }
    out.push_back('"');
}

static void writeDouble(double d, std::string& out) {
    if (std::isnan(d) || std::isinf(d)) {
        // Strictly invalid in JSON. Engine should never produce these; emit "null".
        out += "null";
        return;
    }
    char buf[40];
    if (d == static_cast<long long>(d) && std::fabs(d) < 1e16) {
        // Integral double — keep the ".0" so JSON parsers treat it as a number.
        std::snprintf(buf, sizeof(buf), "%lld.0", static_cast<long long>(d));
    } else {
        // 15 significant digits: this is the minimum that guarantees uniqueness
        // for our domain (CVSS-like scores 0.10–10.00, fixed-point amounts to
        // 1e-8 precision). Avoids the cosmetic noise of %.17g while still
        // preserving every decimal we actually emit.
        std::snprintf(buf, sizeof(buf), "%.15g", d);
    }
    out += buf;
}

void Value::writeTo(std::string& out) const {
    switch (type_) {
        case Type::Null:   out += "null"; return;
        case Type::Bool:   out += boolVal_ ? "true" : "false"; return;
        case Type::Int: {
            char buf[32];
            std::snprintf(buf, sizeof(buf), "%lld", intVal_);
            out += buf;
            return;
        }
        case Type::Double: writeDouble(doubleVal_, out); return;
        case Type::String: writeString(stringVal_, out); return;
        case Type::Array: {
            out.push_back('[');
            bool first = true;
            if (arrayVal_) for (const auto& v : *arrayVal_) {
                if (!first) out.push_back(',');
                first = false;
                v.writeTo(out);
            }
            out.push_back(']');
            return;
        }
        case Type::Object: {
            out.push_back('{');
            bool first = true;
            if (objectVal_) for (const auto& [k, v] : *objectVal_) {
                if (!first) out.push_back(',');
                first = false;
                writeString(k, out);
                out.push_back(':');
                v.writeTo(out);
            }
            out.push_back('}');
            return;
        }
    }
}

std::string Value::dump() const {
    std::string out;
    out.reserve(64);
    writeTo(out);
    return out;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

namespace {

struct Parser {
    std::string_view src;
    size_t pos = 0;

    [[noreturn]] void fail(const char* msg) const {
        throw ParseError(std::string("JSON parse error at offset ") +
                         std::to_string(pos) + ": " + msg);
    }

    void skipWs() {
        while (pos < src.size()) {
            char c = src[pos];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') ++pos;
            else break;
        }
    }

    char peek() {
        if (pos >= src.size()) fail("unexpected end of input");
        return src[pos];
    }

    char consume() {
        if (pos >= src.size()) fail("unexpected end of input");
        return src[pos++];
    }

    void expect(char c) {
        if (consume() != c) {
            --pos;
            fail("expected specific character");
        }
    }

    bool match(const char* lit) {
        size_t n = std::strlen(lit);
        if (pos + n > src.size()) return false;
        if (std::memcmp(src.data() + pos, lit, n) != 0) return false;
        pos += n;
        return true;
    }

    std::string parseString() {
        expect('"');
        std::string out;
        out.reserve(16);
        while (pos < src.size()) {
            char c = src[pos++];
            if (c == '"') return out;
            if (c == '\\') {
                if (pos >= src.size()) fail("unterminated string escape");
                char esc = src[pos++];
                switch (esc) {
                    case '"':  out.push_back('"');  break;
                    case '\\': out.push_back('\\'); break;
                    case '/':  out.push_back('/');  break;
                    case 'b':  out.push_back('\b'); break;
                    case 'f':  out.push_back('\f'); break;
                    case 'n':  out.push_back('\n'); break;
                    case 'r':  out.push_back('\r'); break;
                    case 't':  out.push_back('\t'); break;
                    case 'u':  fail("\\u escapes are not supported by MiniJson (closed grammar)");
                    default:   fail("unknown escape sequence");
                }
            } else {
                out.push_back(c);
            }
        }
        fail("unterminated string");
    }

    Value parseNumber() {
        size_t start = pos;
        bool isDouble = false;
        if (src[pos] == '-') ++pos;
        while (pos < src.size() && std::isdigit(static_cast<unsigned char>(src[pos]))) ++pos;
        if (pos < src.size() && src[pos] == '.') {
            isDouble = true;
            ++pos;
            while (pos < src.size() && std::isdigit(static_cast<unsigned char>(src[pos]))) ++pos;
        }
        if (pos < src.size() && (src[pos] == 'e' || src[pos] == 'E')) {
            isDouble = true;
            ++pos;
            if (pos < src.size() && (src[pos] == '+' || src[pos] == '-')) ++pos;
            while (pos < src.size() && std::isdigit(static_cast<unsigned char>(src[pos]))) ++pos;
        }
        std::string tok(src.data() + start, pos - start);
        try {
            if (isDouble) return Value(std::stod(tok));
            return Value(static_cast<long long>(std::stoll(tok)));
        } catch (const std::exception&) {
            fail("invalid number literal");
        }
    }

    Value parseValue() {
        skipWs();
        if (pos >= src.size()) fail("expected value");
        char c = src[pos];
        if (c == '{') return parseObject();
        if (c == '[') return parseArray();
        if (c == '"') return Value(parseString());
        if (c == 't' && match("true"))  return Value(true);
        if (c == 'f' && match("false")) return Value(false);
        if (c == 'n' && match("null"))  return Value(nullptr);
        if (c == '-' || std::isdigit(static_cast<unsigned char>(c))) return parseNumber();
        fail("unrecognized token");
    }

    Value parseArray() {
        expect('[');
        Value arr = Value::array();
        skipWs();
        if (pos < src.size() && src[pos] == ']') { ++pos; return arr; }
        while (true) {
            arr.push_back(parseValue());
            skipWs();
            if (pos >= src.size()) fail("expected , or ]");
            char c = src[pos++];
            if (c == ']') return arr;
            if (c != ',') fail("expected , or ]");
            skipWs();
        }
    }

    Value parseObject() {
        expect('{');
        Value obj = Value::object();
        auto& entries = obj.asObject();
        skipWs();
        if (pos < src.size() && src[pos] == '}') { ++pos; return obj; }
        while (true) {
            skipWs();
            std::string key = parseString();
            skipWs();
            expect(':');
            entries.emplace_back(std::move(key), parseValue());
            skipWs();
            if (pos >= src.size()) fail("expected , or }");
            char c = src[pos++];
            if (c == '}') return obj;
            if (c != ',') fail("expected , or }");
        }
    }
};

}  // namespace

Value Value::parse(std::string_view text) {
    Parser p{text, 0};
    p.skipWs();
    Value v = p.parseValue();
    p.skipWs();
    if (p.pos != text.size()) {
        throw ParseError("trailing characters after JSON value");
    }
    return v;
}

}  // namespace poc::minijson
