# R8 rules for the xelpfin release build.
#
# React Native, Hermes, Media3 and AndroidX ship their own consumer rules inside their AARs.
# The rules here cover what those do not: classes reached by name from JS or from generated code.

# The app's own native module (UDP discovery, decoder list) and the application classes.
-keep class com.xelpfin.app.** { *; }

# react-native-video: its view manager, props and event classes are looked up by name.
-keep class com.brentvatne.** { *; }
-dontwarn com.brentvatne.**

# AsyncStorage.
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# TurboModule and Fabric codegen specs are reached through JNI and reflection.
-keep class com.facebook.react.turbomodule.** { *; }
-keep class * extends com.facebook.react.bridge.JavaScriptModule { *; }
-keep class * extends com.facebook.react.bridge.NativeModule { *; }
-keepclassmembers class * { @com.facebook.react.bridge.ReactMethod *; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.ReactProp *; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.ReactPropGroup *; }

# Media3 optional extensions that react-native-video references but the app does not bundle.
-dontwarn androidx.media3.**
-dontwarn com.google.ads.interactivemedia.**
-dontwarn com.google.android.gms.**

# Keep line numbers so crash stacks from the stick can be read against the mapping file.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
