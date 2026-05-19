#pragma once

// Minimal JSON parser/writer purpose-built for the poc_engine stdio protocol.
//
// Closed-grammar deviations from RFC 8259 (deliberate):
//   - No \u escapes. Strings on the wire are ASCII hex / address text.
//   - No scientific notation on output. Integers print as "%lld", floats as
//     a minimal-precision decimal with at least one digit after the point.
//   - No duplicate-key handling guarantee on input (last value wins).
//   - Compact output only (no pretty-printing).
//

#include <cstdint>
#include <initializer_list>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace poc::minijson {

class Value;

using ArrayEntries  = std::vector<Value>;
using ObjectEntries = std::vector<std::pair<std::string, Value>>;

enum class Type { Null, Bool, Int, Double, String, Array, Object };

class ParseError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};


using exception = ParseError;

class Value {
public:
    Value();                                            // null
    Value(std::nullptr_t);
    Value(bool b);
    Value(int i);
    Value(unsigned u);
    Value(long i);
    Value(unsigned long u);
    Value(long long i);
    Value(unsigned long long u);
    Value(double d);
    Value(const char* s);
    Value(std::string s);

    // Object construction:  Value{{"k1", v1}, {"k2", v2}, ...}
    Value(std::initializer_list<std::pair<std::string, Value>> init);

    Value(const Value& other);
    Value(Value&& other) noexcept;
    Value& operator=(const Value& other);
    Value& operator=(Value&& other) noexcept;
    ~Value();

    static Value array();
    static Value object();

    Type type() const noexcept { return type_; }
    bool isNull()   const noexcept { return type_ == Type::Null; }
    bool isBool()   const noexcept { return type_ == Type::Bool; }
    bool isInt()    const noexcept { return type_ == Type::Int; }
    bool isDouble() const noexcept { return type_ == Type::Double; }
    bool isNumber() const noexcept { return isInt() || isDouble(); }
    bool isString() const noexcept { return type_ == Type::String; }
    bool isArray()  const noexcept { return type_ == Type::Array; }
    bool isObject() const noexcept { return type_ == Type::Object; }

    bool        asBool()   const;
    long long   asInt()    const;
    double      asDouble() const;
    const std::string&  asString() const;
    const ArrayEntries& asArray()  const;
    ArrayEntries&       asArray();
    const ObjectEntries& asObject() const;
    ObjectEntries&       asObject();

    // Object access
    bool contains(std::string_view key) const;
    const Value& at(std::string_view key) const;
    Value& operator[](std::string_view key);

    // Array access
    size_t size() const;
    void push_back(Value v);
    Value&       operator[](size_t idx);
    const Value& operator[](size_t idx) const;

    // Array iteration (so `for (auto& v : valueThatIsArray)` works).
    ArrayEntries::iterator       begin();
    ArrayEntries::iterator       end();
    ArrayEntries::const_iterator begin() const;
    ArrayEntries::const_iterator end() const;

    template<typename T> T get() const;

    // value("key", default) — return default if missing or wrong type.
    template<typename T> T value(std::string_view key, T def) const;

    std::string dump() const;
    static Value parse(std::string_view text);

private:
    Type type_ = Type::Null;
    bool boolVal_ = false;
    long long intVal_ = 0;
    double doubleVal_ = 0.0;
    std::string stringVal_;
    std::unique_ptr<ArrayEntries>  arrayVal_;
    std::unique_ptr<ObjectEntries> objectVal_;

    void writeTo(std::string& out) const;
};

// ─── Template specializations declared here, defined in MiniJson.cpp ─────────

// On common platforms uint32_t == unsigned int, so callers using
// get<uint32_t>() / value<uint32_t>() are satisfied by the unsigned overload.

template<> std::string Value::get<std::string>() const;
template<> bool        Value::get<bool>()        const;
template<> double      Value::get<double>()      const;
template<> int         Value::get<int>()         const;
template<> long long   Value::get<long long>()   const;
template<> uint16_t    Value::get<uint16_t>()    const;
template<> unsigned    Value::get<unsigned>()    const;

template<> std::string Value::value<std::string>(std::string_view key, std::string def) const;
template<> int         Value::value<int>(std::string_view key, int def)                 const;
template<> unsigned    Value::value<unsigned>(std::string_view key, unsigned def)       const;
template<> Value       Value::value<Value>(std::string_view key, Value def)             const;

}  // namespace poc::minijson
